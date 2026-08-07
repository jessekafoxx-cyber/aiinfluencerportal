import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { api } from "@/lib/api";
import {
  Crown,
  Phone,
  CheckCircle2,
  Circle,
  Calendar,
  Clock,
  Play,
  Flame,
  Star,
  ArrowRight,
  ExternalLink,
  Hammer,
  Rocket,
  Map as MapIcon,
  FileText,
  Link as LinkIcon,
  CreditCard,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Folder,
  Video,
  MessageCircle,
  Send,
  Lock,
  Plus,
  Trash2,
  Sparkles,
} from "lucide-react";

const GOLD = "#C9A44C";

const PHASES = [
  {
    number: 1,
    title: "War Map",
    short: "Strategy",
    description:
      "A working session to lock the offer, the math and the exact build plan before any code or copy is written.",
    icon: MapIcon,
  },
  {
    number: 2,
    title: "The Build",
    short: "Build",
    description:
      "Funnel, ads, emails, automations and onboarding. Built for you by our team to spec from the War Map.",
    icon: Hammer,
  },
  {
    number: 3,
    title: "Launch Call",
    short: "Launch",
    description:
      "Walk through the live funnel, push it live with the team and lock in the first 7 day push plan.",
    icon: Rocket,
  },
  {
    number: 4,
    title: "Live Workshops",
    short: "Workshops",
    description:
      "Weekly live workshops with the Apex team for 12 weeks after launch. Replays land here as soon as each session ends.",
    icon: Star,
  },
] as const;

type PhaseDef = (typeof PHASES)[number];

type StripeConnection = {
  connected: boolean;
  maskedKey?: string;
  accountLabel?: string | null;
  syncStatus?: string;
  lastSyncError?: string | null;
  lastSyncAt?: string | null;
};

// ─── Building blocks ────────────────────────────────────────────────────────

function GoldFoilTitle({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--app-font-display)",
        background: "linear-gradient(135deg, #FFD700, #C9A44C, #F4E0A0)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
      }}
    >
      {children}
    </span>
  );
}

function GoldCard({
  children,
  className = "",
  inner = "p-5",
  intensity = 0.45,
}: {
  children: React.ReactNode;
  className?: string;
  inner?: string;
  intensity?: number;
}) {
  return (
    <div
      className={`rounded-2xl p-[1px] ${className}`}
      style={{
        background: `linear-gradient(180deg, rgba(201,164,76,${intensity}) 0%, rgba(201,164,76,0.08) 50%, rgba(201,164,76,${intensity * 0.7}) 100%)`,
      }}
    >
      <div className={`rounded-2xl bg-[#0A0A0A] ${inner}`}>{children}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: "bg-yellow-500/15", text: "text-yellow-400", label: "Pending" },
    "in-progress": { bg: "bg-blue-500/15", text: "text-blue-400", label: "In Progress" },
    completed: { bg: "bg-green-500/15", text: "text-green-400", label: "Done" },
    upcoming: { bg: "bg-white/[0.06]", text: "text-white/65", label: "Upcoming" },
    ready: { bg: "bg-green-500/15", text: "text-green-400", label: "Ready" },
    "needs-review": { bg: "bg-amber-500/15", text: "text-amber-400", label: "Needs Review" },
    open: { bg: "bg-yellow-500/15", text: "text-yellow-400", label: "Open" },
    answered: { bg: "bg-green-500/15", text: "text-green-400", label: "Answered" },
    archived: { bg: "bg-white/[0.06]", text: "text-white/55", label: "Archived" },
  };
  const c = config[status] || { bg: "bg-white/[0.06]", text: "text-white/65", label: status };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${c.bg} ${c.text}`}
    >
      {c.label}
    </span>
  );
}

// ─── Phase stepper at the top ───────────────────────────────────────────────

function PhaseStepper({
  current,
  active,
  onSelect,
  perPhase,
}: {
  current: number;
  active: number;
  onSelect: (n: number) => void;
  perPhase: Record<number, { milestones: any[]; assets: any[] }>;
}) {
  const completedPerPhase = (n: number) => {
    const m = perPhase[n]?.milestones || [];
    const total = m.length;
    const done = m.filter((x) => x.status === "completed").length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  };

  return (
    <GoldCard inner="p-5 sm:p-6" intensity={0.5}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-[0.22em] mb-1"
            style={{ color: GOLD }}
          >
            Build Pipeline
          </p>
          <h3
            className="text-[16px] sm:text-[18px] font-bold uppercase tracking-tight text-white"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Four Phases. One Outcome.
          </h3>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">
            You Are On
          </p>
          <p
            className="text-[16px] font-bold leading-none mt-0.5"
            style={{ fontFamily: "var(--app-font-display)", color: GOLD }}
          >
            Phase {current}
          </p>
        </div>
      </div>

      {/* Stepper rail */}
      <div className="relative">
        <div className="absolute left-0 right-0 top-5 h-[2px] bg-white/[0.06] hidden sm:block" />
        <div
          className="absolute left-0 top-5 h-[2px] hidden sm:block transition-all"
          style={{
            width: `${Math.max(0, ((current - 1) / 3) * 100)}%`,
            background: `linear-gradient(90deg, ${GOLD}, #FFD700)`,
            boxShadow: `0 0 12px rgba(201,164,76,0.4)`,
          }}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-2 relative">
          {PHASES.map((phase) => {
            const isActive = active === phase.number;
            const isCurrent = current === phase.number;
            const isPast = current > phase.number;
            const isFuture = current < phase.number;
            const Icon = phase.icon;
            const { done, total, pct } = completedPerPhase(phase.number);

            return (
              <button
                key={phase.number}
                onClick={() => onSelect(phase.number)}
                className="group relative text-left flex flex-col items-center text-center gap-2"
                data-testid={`phase-tab-${phase.number}`}
              >
                <div
                  className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    isActive ? "scale-110" : "group-hover:scale-105"
                  }`}
                  style={{
                    background: isPast || isCurrent
                      ? "linear-gradient(135deg, #FFD700, #C9A44C)"
                      : "#0A0A0A",
                    border: isCurrent || isActive
                      ? `2px solid ${GOLD}`
                      : isPast
                      ? "2px solid rgba(201,164,76,0.5)"
                      : "2px solid rgba(255,255,255,0.08)",
                    boxShadow: isActive
                      ? `0 0 20px rgba(201,164,76,0.5)`
                      : "none",
                  }}
                >
                  {isPast ? (
                    <CheckCircle2 className="w-5 h-5 text-black" />
                  ) : isCurrent ? (
                    <Icon className="w-4 h-4 text-black" />
                  ) : (
                    <Icon
                      className={`w-4 h-4 ${isActive ? "text-yellow-400" : "text-white/40"}`}
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <p
                    className={`text-[10px] font-bold uppercase tracking-[0.18em] ${
                      isActive ? "text-yellow-400" : isFuture ? "text-white/35" : "text-white/65"
                    }`}
                  >
                    Phase {phase.number}
                  </p>
                  <p
                    className={`text-[12px] font-bold uppercase tracking-tight leading-tight mt-0.5 ${
                      isActive ? "text-white" : isFuture ? "text-white/45" : "text-white/80"
                    }`}
                    style={{ fontFamily: "var(--app-font-display)" }}
                  >
                    {phase.short}
                  </p>
                  {total > 0 ? (
                    <p className="text-[10px] text-white/45 mt-0.5">
                      {done}/{total} done
                    </p>
                  ) : isFuture ? (
                    <p className="text-[10px] text-white/35 mt-0.5">Locked</p>
                  ) : (
                    <p className="text-[10px] text-white/45 mt-0.5">No items</p>
                  )}
                </div>
                {/* Progress bar under each step */}
                <div className="w-full h-[3px] rounded-full bg-white/[0.05] overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${pct}%`,
                      background:
                        pct === 100
                          ? "linear-gradient(90deg, #16a34a, #4ade80)"
                          : `linear-gradient(90deg, ${GOLD}, #FFD700)`,
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </GoldCard>
  );
}

// ─── Phase hero ─────────────────────────────────────────────────────────────

function PhaseHero({
  phase,
  isCurrent,
  milestones,
  assets,
  calls,
}: {
  phase: PhaseDef;
  isCurrent: boolean;
  milestones: any[];
  assets: any[];
  calls: any[];
}) {
  const Icon = phase.icon;
  const completed = milestones.filter((m) => m.status === "completed").length;
  const total = milestones.length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  return (
    <GoldCard inner="p-6 sm:p-8" intensity={0.55}>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5">
        <div className="flex items-start gap-4 min-w-0">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
            style={{
              background: "linear-gradient(135deg, rgba(255,215,0,0.18), rgba(201,164,76,0.06))",
              border: `1px solid ${GOLD}55`,
            }}
          >
            <Icon className="w-6 h-6 text-yellow-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p
                className="text-[10px] font-bold uppercase tracking-[0.22em]"
                style={{ color: GOLD }}
              >
                Phase {phase.number}
              </p>
              {isCurrent && (
                <span
                  className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.18em] px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(34,197,94,0.15)", color: "#4ade80" }}
                >
                  <Flame className="w-2.5 h-2.5" /> Active
                </span>
              )}
            </div>
            <h2
              className="text-[26px] sm:text-[34px] font-bold uppercase tracking-tight leading-[1] [text-wrap:balance]"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              <GoldFoilTitle>{phase.title}</GoldFoilTitle>
            </h2>
            <p className="text-[13px] sm:text-[14px] text-white/65 mt-2 max-w-xl leading-relaxed">
              {phase.description}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:min-w-[280px]">
          {[
            { label: "Done", value: `${completed}/${total || "0"}` },
            { label: "Assets", value: assets.length },
            { label: "Calls", value: calls.length },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl p-3 text-center"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(201,164,76,0.15)",
              }}
            >
              <p
                className="text-[18px] sm:text-[22px] font-bold leading-none"
                style={{ fontFamily: "var(--app-font-display)", color: GOLD }}
              >
                {s.value}
              </p>
              <p className="text-[9px] uppercase tracking-wider text-white/55 mt-1 font-bold">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {total > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider font-bold text-white/55">
              Phase Progress
            </span>
            <span
              className="text-[12px] font-bold"
              style={{ color: GOLD, fontFamily: "var(--app-font-display)" }}
            >
              {pct}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-white/[0.05] overflow-hidden">
            <div
              className="h-full transition-all"
              style={{
                width: `${pct}%`,
                background:
                  pct === 100
                    ? "linear-gradient(90deg, #16a34a, #4ade80)"
                    : `linear-gradient(90deg, ${GOLD}, #FFD700)`,
                boxShadow: `0 0 12px rgba(201,164,76,0.45)`,
              }}
            />
          </div>
        </div>
      )}
    </GoldCard>
  );
}

// ─── Milestones list per phase ──────────────────────────────────────────────

function PhaseMilestones({
  items,
  isAdmin,
  onToggle,
  onAdd,
  onDelete,
}: {
  items: any[];
  isAdmin: boolean;
  onToggle: (id: number, status: string) => void;
  onAdd: (data: { milestone: string; description?: string }) => void;
  onDelete: (id: number) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [milestone, setMilestone] = useState("");
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!milestone.trim()) return;
    onAdd({ milestone: milestone.trim(), description: description.trim() || undefined });
    setMilestone("");
    setDescription("");
    setAddOpen(false);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3
          className="text-[14px] font-bold text-white uppercase tracking-wider flex items-center gap-2"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          <CheckCircle2 className="w-4 h-4" style={{ color: GOLD }} />
          Milestones
        </h3>
        {isAdmin && (
          <button
            onClick={() => setAddOpen(!addOpen)}
            className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded border transition-colors"
            style={{
              color: GOLD,
              borderColor: `${GOLD}55`,
              background: "rgba(201,164,76,0.06)",
            }}
            data-testid="add-milestone-button"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        )}
      </div>

      {isAdmin && addOpen && (
        <div className="mb-3 p-3 rounded-xl border border-yellow-500/20 bg-white/[0.02] space-y-2">
          <input
            value={milestone}
            onChange={(e) => setMilestone(e.target.value)}
            placeholder="Milestone title"
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/40"
            data-testid="add-milestone-title"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            rows={2}
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/40 resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setAddOpen(false)}
              className="px-3 py-1 text-[12px] text-white/55 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              className="px-3 py-1 text-[12px] font-bold uppercase tracking-wider rounded text-black"
              style={{ background: "linear-gradient(135deg, #FFD700, #C9A44C)" }}
              data-testid="submit-milestone"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-6 text-center">
          <Circle className="w-7 h-7 text-white/10 mx-auto mb-2" />
          <p className="text-[12px] text-white/55">No milestones in this phase yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="group flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-yellow-500/15 transition-colors"
              data-testid={`milestone-${item.id}`}
            >
              <button
                onClick={() =>
                  isAdmin &&
                  onToggle(item.id, item.status === "completed" ? "upcoming" : "completed")
                }
                disabled={!isAdmin}
                className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center mt-0.5 transition-all ${
                  item.status === "completed"
                    ? "bg-green-500/20 ring-1 ring-green-500/40"
                    : item.status === "in-progress"
                    ? "bg-yellow-500/20 ring-1 ring-yellow-500/40"
                    : "bg-white/[0.06]"
                } ${isAdmin ? "cursor-pointer hover:scale-110" : "cursor-default"}`}
              >
                {item.status === "completed" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                ) : item.status === "in-progress" ? (
                  <Flame className="w-3.5 h-3.5 text-yellow-400" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-white/45" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p
                    className={`text-[13px] font-medium ${
                      item.status === "completed" ? "text-white/65 line-through decoration-white/20" : "text-white"
                    }`}
                  >
                    {item.milestone}
                  </p>
                  <StatusPill status={item.status} />
                </div>
                {item.description && (
                  <p className="text-[12px] text-white/55 mt-0.5">{item.description}</p>
                )}
                {item.targetDate && (
                  <p className="text-[10px] text-white/40 mt-1 uppercase tracking-wider">
                    Target {new Date(item.targetDate).toLocaleDateString()}
                  </p>
                )}
              </div>
              {isAdmin && (
                <button
                  onClick={() => {
                    if (confirm("Delete this milestone?")) onDelete(item.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/10 text-white/30 hover:text-red-400"
                  data-testid={`delete-milestone-${item.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Build assets per phase ─────────────────────────────────────────────────

function CategoryIcon({ category }: { category: string }) {
  const c = category.toLowerCase();
  if (c.includes("doc") || c.includes("brief") || c.includes("war")) return <FileText className="w-3.5 h-3.5" />;
  if (c.includes("link")) return <LinkIcon className="w-3.5 h-3.5" />;
  if (c.includes("video") || c.includes("recording") || c.includes("creative")) return <Video className="w-3.5 h-3.5" />;
  return <Folder className="w-3.5 h-3.5" />;
}

function PhaseAssets({
  items,
  phaseNumber,
  isAdmin,
  onAdd,
  onDelete,
}: {
  items: any[];
  phaseNumber: number;
  isAdmin: boolean;
  onAdd: (data: any) => void;
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("general");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("ready");

  const submit = () => {
    if (!title.trim()) return;
    onAdd({
      title: title.trim(),
      category: category.trim() || "general",
      assetType: "link",
      url: url.trim() || undefined,
      notes: notes.trim() || undefined,
      status,
      phaseNumber,
    });
    setTitle("");
    setUrl("");
    setNotes("");
    setCategory("general");
    setStatus("ready");
    setOpen(false);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3
          className="text-[14px] font-bold text-white uppercase tracking-wider flex items-center gap-2"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          <Folder className="w-4 h-4" style={{ color: GOLD }} />
          Build Assets
        </h3>
        {isAdmin && (
          <button
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded border transition-colors"
            style={{ color: GOLD, borderColor: `${GOLD}55`, background: "rgba(201,164,76,0.06)" }}
            data-testid="add-asset-button"
          >
            <Plus className="w-3 h-3" /> Upload
          </button>
        )}
      </div>

      {isAdmin && open && (
        <div className="mb-3 p-3 rounded-xl border border-yellow-500/20 bg-white/[0.02] space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Asset title (e.g. Cold open recording set 1)"
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/40"
            data-testid="asset-title"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[13px] text-white focus:outline-none focus:border-yellow-500/40"
            >
              <option value="war-map">War Map</option>
              <option value="creative">Creative / Recordings</option>
              <option value="funnel">Funnel</option>
              <option value="ads">Ads</option>
              <option value="emails">Emails</option>
              <option value="automation">Automation</option>
              <option value="vsl">VSL</option>
              <option value="launch">Launch</option>
              <option value="general">General</option>
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[13px] text-white focus:outline-none focus:border-yellow-500/40"
            >
              <option value="ready">Ready</option>
              <option value="in-progress">In Progress</option>
              <option value="needs-review">Needs Review</option>
            </select>
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://drive.google.com/..."
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[13px] text-white placeholder:text-white/30 font-mono focus:outline-none focus:border-yellow-500/40"
            data-testid="asset-url"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes for the client"
            rows={2}
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/40 resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1 text-[12px] text-white/55 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              className="px-3 py-1 text-[12px] font-bold uppercase tracking-wider rounded text-black"
              style={{ background: "linear-gradient(135deg, #FFD700, #C9A44C)" }}
              data-testid="submit-asset"
            >
              Upload
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-6 text-center">
          <Folder className="w-7 h-7 text-white/10 mx-auto mb-2" />
          <p className="text-[12px] text-white/55">No assets uploaded for this phase yet</p>
          <p className="text-[10px] text-white/40 mt-1">
            Deliverables will land here as they are built.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((a) => (
            <div
              key={a.id}
              className="group p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-yellow-500/20 transition-colors"
              data-testid={`asset-${a.id}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ color: GOLD, background: "rgba(201,164,76,0.1)" }}
                  >
                    <CategoryIcon category={a.category} />
                    {a.category}
                  </span>
                  <StatusPill status={a.status} />
                </div>
                {isAdmin && (
                  <button
                    onClick={() => {
                      if (confirm("Delete this asset?")) onDelete(a.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/10 text-white/30 hover:text-red-400"
                    data-testid={`delete-asset-${a.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-[14px] font-semibold text-white truncate">{a.title}</p>
              {a.notes && (
                <p className="text-[12px] text-white/55 mt-1 line-clamp-2">{a.notes}</p>
              )}
              {a.url && (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-bold uppercase tracking-wider hover:opacity-80"
                  style={{ color: GOLD }}
                >
                  Open <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Calls list per phase ───────────────────────────────────────────────────

function PhaseCalls({ items }: { items: any[] }) {
  if (items.length === 0) {
    return (
      <section>
        <h3
          className="text-[14px] font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          <Phone className="w-4 h-4" style={{ color: GOLD }} />
          Call Recordings
        </h3>
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-6 text-center">
          <Phone className="w-7 h-7 text-white/10 mx-auto mb-2" />
          <p className="text-[12px] text-white/55">No calls recorded for this phase yet</p>
        </div>
      </section>
    );
  }
  return (
    <section>
      <h3
        className="text-[14px] font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2"
        style={{ fontFamily: "var(--app-font-display)" }}
      >
        <Phone className="w-4 h-4" style={{ color: GOLD }} />
        Call Recordings
      </h3>
      <div className="space-y-2">
        {items.map((call: any) => (
          <div
            key={call.id}
            className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-yellow-500/15 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-white truncate">{call.title}</p>
                {call.description && (
                  <p className="text-[11px] text-white/55 mt-0.5 line-clamp-2">{call.description}</p>
                )}
                <div className="flex items-center gap-3 mt-2 text-[11px] text-white/55">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {new Date(call.callDate).toLocaleDateString()}
                  </span>
                  {call.duration && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {call.duration} min
                    </span>
                  )}
                </div>
              </div>
              {call.recordingUrl && (
                <a
                  href={call.recordingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider hover:opacity-80 transition-opacity"
                  style={{ background: "rgba(201,164,76,0.12)", color: GOLD }}
                >
                  <Play className="w-3 h-3" /> Replay
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Updates / requests channel ─────────────────────────────────────────────

function UpdatesChannel({
  updates,
  isAdmin,
  myUserId,
  phaseNumber,
  onPost,
  onMark,
  onDelete,
  targetUserId,
}: {
  updates: any[];
  isAdmin: boolean;
  myUserId: number;
  phaseNumber: number;
  onPost: (data: { kind: string; body: string; title?: string }) => void;
  onMark: (id: number, status: string) => void;
  onDelete: (id: number) => void;
  targetUserId: number;
}) {
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>(isAdmin ? "update" : "request");

  const submit = () => {
    if (!body.trim()) return;
    onPost({ kind, body: body.trim(), title: title.trim() || undefined });
    setBody("");
    setTitle("");
  };

  const phaseUpdates = updates.filter((u) => u.phaseNumber === phaseNumber);

  return (
    <GoldCard inner="p-5" intensity={0.4}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4" style={{ color: GOLD }} />
          <h3
            className="text-[14px] font-bold text-white uppercase tracking-wider"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Updates & Requests
          </h3>
        </div>
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
          style={{ color: GOLD, background: "rgba(201,164,76,0.1)" }}
        >
          Phase {phaseNumber}
        </span>
      </div>

      {/* Composer */}
      <div className="mb-4 p-3 rounded-xl border border-yellow-500/15 bg-white/[0.02] space-y-2">
        <div className="flex gap-1">
          {(isAdmin ? ["update", "request"] : ["request", "reply"]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded ${
                kind === k ? "text-black" : "text-white/55"
              }`}
              style={
                kind === k
                  ? { background: "linear-gradient(135deg, #FFD700, #C9A44C)" }
                  : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
              }
              data-testid={`composer-kind-${k}`}
            >
              {k}
            </button>
          ))}
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Optional title"
          className="w-full px-2.5 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-md text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/40"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            isAdmin
              ? kind === "update"
                ? "Post an update for the client (what is shipped, what is next)"
                : "Ask the client for something they need to provide"
              : kind === "request"
              ? "Tell the build team what you need or what is blocking you"
              : "Reply to the team"
          }
          rows={3}
          className="w-full px-2.5 py-2 bg-white/[0.04] border border-white/[0.08] rounded-md text-[12.5px] text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/40 resize-none"
          data-testid="composer-body"
        />
        <div className="flex justify-end">
          <button
            onClick={submit}
            disabled={!body.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-bold text-black uppercase tracking-wider disabled:opacity-40"
            style={{ background: "linear-gradient(135deg, #FFD700, #C9A44C)" }}
            data-testid="post-update"
          >
            <Send className="w-3 h-3" /> Post
          </button>
        </div>
      </div>

      {/* Feed */}
      {phaseUpdates.length === 0 ? (
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-5 text-center">
          <MessageCircle className="w-6 h-6 text-white/10 mx-auto mb-2" />
          <p className="text-[12px] text-white/55">No updates yet for this phase</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
          {phaseUpdates.map((u) => {
            const mine = u.authorRole === (isAdmin ? "admin" : "client");
            const kindColor =
              u.kind === "request"
                ? "bg-amber-500/15 text-amber-400"
                : u.kind === "reply"
                ? "bg-blue-500/15 text-blue-400"
                : "bg-yellow-500/15 text-yellow-400";
            return (
              <div
                key={u.id}
                className={`group p-3 rounded-lg border ${
                  u.kind === "request"
                    ? "border-amber-500/20 bg-amber-500/[0.02]"
                    : "border-white/[0.06] bg-white/[0.02]"
                }`}
                data-testid={`update-${u.id}`}
              >
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span
                    className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${kindColor}`}
                  >
                    {u.kind === "request" ? <AlertTriangle className="w-2.5 h-2.5" /> : <Sparkles className="w-2.5 h-2.5" />}
                    {u.kind}
                  </span>
                  <span className="text-[11px] font-semibold text-white">
                    {u.authorName || (u.authorRole === "admin" ? "Apex Build Team" : "Client")}
                  </span>
                  <span className="text-[10px] text-white/40">
                    {new Date(u.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <StatusPill status={u.status} />
                </div>
                {u.title && (
                  <p className="text-[12.5px] font-bold text-white mb-0.5">{u.title}</p>
                )}
                <p className="text-[12px] text-white/75 whitespace-pre-wrap leading-relaxed">
                  {u.body}
                </p>
                <div className="flex items-center gap-2 mt-2 opacity-60 group-hover:opacity-100 transition-opacity">
                  {u.status === "open" && (mine || isAdmin) && (
                    <button
                      onClick={() => onMark(u.id, "answered")}
                      className="text-[10px] font-bold uppercase tracking-wider text-green-400/80 hover:text-green-400"
                    >
                      Mark answered
                    </button>
                  )}
                  {u.status !== "open" && (mine || isAdmin) && (
                    <button
                      onClick={() => onMark(u.id, "open")}
                      className="text-[10px] font-bold uppercase tracking-wider text-white/45 hover:text-white"
                    >
                      Reopen
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => {
                        if (confirm("Delete this update?")) onDelete(u.id);
                      }}
                      className="text-[10px] font-bold uppercase tracking-wider text-white/35 hover:text-red-400"
                      data-testid={`delete-update-${u.id}`}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </GoldCard>
  );
}

// ─── Support card ───────────────────────────────────────────────────────────

function SupportCard() {
  return (
    <GoldCard inner="p-4" intensity={0.35}>
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4" style={{ color: GOLD }} />
        <h3
          className="text-[13px] font-bold text-white uppercase tracking-wider"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          Direct Support
        </h3>
      </div>
      <p className="text-[12px] text-white/65 leading-relaxed">
        Need the build team fast? Open the support chat in the bottom right
        corner and the team will pick it up from there.
      </p>
    </GoldCard>
  );
}

// ─── Workshops list (phase 4) ───────────────────────────────────────────────

function WorkshopsList({ workshops }: { workshops: any[] }) {
  const now = Date.now();
  const sorted = [...workshops].sort(
    (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime()
  );
  const past = sorted.filter((w) => new Date(w.startsAt).getTime() < now);
  const upcoming = [...sorted]
    .filter((w) => new Date(w.startsAt).getTime() >= now)
    .reverse();
  const next = upcoming[0];

  return (
    <section className="space-y-3">
      <h3
        className="text-[14px] font-bold text-white uppercase tracking-wider flex items-center gap-2"
        style={{ fontFamily: "var(--app-font-display)" }}
      >
        <Star className="w-4 h-4" style={{ color: GOLD }} />
        Live Workshops
      </h3>

      {next && (
        <div
          className="rounded-xl p-4 flex items-center gap-3 border border-yellow-500/25"
          style={{
            background: "linear-gradient(135deg, rgba(255,215,0,0.08), rgba(201,164,76,0.02))",
          }}
        >
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "rgba(255,215,0,0.18)" }}
          >
            <Video className="w-4 h-4 text-yellow-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className="text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{ color: GOLD }}
            >
              Next Live Workshop
            </p>
            <p className="text-[14px] font-semibold text-white truncate">{next.title}</p>
            <p className="text-[11px] text-white/55">
              {new Date(next.startsAt).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
              {" / "}
              {next.durationMinutes} min
            </p>
          </div>
          <a
            href={next.meetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold text-black uppercase tracking-wider"
            style={{ background: "linear-gradient(135deg, #FFD700, #C9A44C)" }}
          >
            Join <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {past.length === 0 && !next ? (
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-6 text-center">
          <Star className="w-7 h-7 text-white/10 mx-auto mb-2" />
          <p className="text-[12px] text-white/55">No workshops scheduled yet</p>
          <p className="text-[10px] text-white/40 mt-1">Replays will appear here as soon as each session ends.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {past.map((w) => (
            <div
              key={w.id}
              className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-yellow-500/15 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-white truncate">{w.title}</p>
                  {w.description && (
                    <p className="text-[12px] text-white/55 mt-0.5 line-clamp-2">{w.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-white/55">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(w.startsAt).toLocaleDateString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {w.durationMinutes} min
                    </span>
                  </div>
                </div>
                {w.recordingUrl ? (
                  <a
                    href={w.recordingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider hover:opacity-80"
                    style={{ background: "rgba(201,164,76,0.12)", color: GOLD }}
                  >
                    <Play className="w-3 h-3" /> Replay
                  </a>
                ) : (
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-white/35 px-2 py-1 rounded bg-white/[0.04]">
                    Replay pending
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Stripe (small admin section, optional) ─────────────────────────────────

function StripeConnectMini({
  connection,
  onChanged,
}: {
  connection: StripeConnection;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const connect = useMutation({
    mutationFn: () => api.alist.connectStripe(apiKey.trim(), label.trim() || undefined),
    onSuccess: () => {
      setOpen(false);
      setApiKey("");
      setLabel("");
      setError(null);
      onChanged();
    },
    onError: (e: any) => setError(e?.message || "Failed to connect"),
  });
  const disconnect = useMutation({
    mutationFn: () => api.alist.disconnectStripe(),
    onSuccess: onChanged,
  });

  return (
    <GoldCard inner="p-4" intensity={0.35}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4" style={{ color: GOLD }} />
          <h3
            className="text-[13px] font-bold text-white uppercase tracking-wider"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Stripe Revenue Tracking
          </h3>
        </div>
        {connection.connected && connection.syncStatus === "ok" && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-green-500/15 text-green-400">
            <ShieldCheck className="w-3 h-3" /> Connected
          </span>
        )}
        {connection.connected && connection.syncStatus === "auth_failed" && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400">
            <AlertTriangle className="w-3 h-3" /> Key Rejected
          </span>
        )}
      </div>
      <p className="text-[12px] text-white/55 mb-3">
        Read-only key. We use this to report your weekly revenue back to you on calls.
      </p>
      {connection.connected ? (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] text-white/55">
            Key <span className="font-mono" style={{ color: GOLD }}>{connection.maskedKey}</span>
          </span>
          {connection.accountLabel && (
            <span className="text-[11px] text-white/55">{connection.accountLabel}</span>
          )}
          <button
            onClick={() => {
              if (confirm("Disconnect Stripe?")) disconnect.mutate();
            }}
            className="ml-auto text-[10px] font-bold uppercase tracking-wider text-white/45 hover:text-red-400"
          >
            Disconnect
          </button>
        </div>
      ) : !open ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-bold text-black uppercase tracking-wider"
          style={{ background: "linear-gradient(135deg, #FFD700, #C9A44C)" }}
        >
          <CreditCard className="w-3 h-3" /> Connect Stripe
        </button>
      ) : (
        <div className="space-y-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="rk_live_..."
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[12px] text-white placeholder:text-white/30 font-mono focus:outline-none focus:border-yellow-500/40"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Account label (optional)"
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/40"
          />
          {error && <p className="text-[11px] text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1 text-[11px] text-white/55 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={() => connect.mutate()}
              disabled={!apiKey.trim() || connect.isPending}
              className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded text-black inline-flex items-center gap-1"
              style={{ background: "linear-gradient(135deg, #FFD700, #C9A44C)", opacity: connect.isPending ? 0.5 : 1 }}
            >
              {connect.isPending && <Loader2 className="w-3 h-3 animate-spin" />} Save
            </button>
          </div>
        </div>
      )}
    </GoldCard>
  );
}

// ─── Locked view (no DFY access) ────────────────────────────────────────────

function LockedView() {
  return (
    <PortalLayout>
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <GoldCard inner="p-8 sm:p-10 max-w-2xl text-center" intensity={0.5}>
          <div
            className="w-16 h-16 mx-auto mb-5 rounded-full flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, rgba(255,215,0,0.18), rgba(201,164,76,0.06))",
              border: `1px solid ${GOLD}66`,
            }}
          >
            <Lock className="w-7 h-7" style={{ color: GOLD }} />
          </div>
          <p
            className="text-[10px] font-bold uppercase tracking-[0.22em] mb-1"
            style={{ color: GOLD }}
          >
            Done For You
          </p>
          <h1
            className="text-[28px] sm:text-[36px] font-bold uppercase tracking-tight leading-[1] mb-3 [text-wrap:balance]"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            <GoldFoilTitle>Productized Build Engagement</GoldFoilTitle>
          </h1>
          <p className="text-[14px] text-white/65 mb-2 leading-relaxed">
            We sit down with you for a War Map call, then our team builds your funnel,
            ads, emails and onboarding for you, and stays on through launch.
          </p>
          <p className="text-[12px] text-white/55 mb-6">
            Four phases. Fixed scope. By application only.
          </p>
          <a
            href="https://www.cookemedia.io/done-for-you"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-[13px] font-bold text-black uppercase tracking-wider transition-all hover:scale-105"
            style={{
              background: "linear-gradient(135deg, #FFD700, #C9A44C)",
              fontFamily: "var(--app-font-display)",
            }}
          >
            Get Started Now
            <ArrowRight className="w-4 h-4" />
          </a>
        </GoldCard>
      </div>
    </PortalLayout>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function DoneForYou() {
  const queryClient = useQueryClient();

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.getMe,
  });

  const isAList = !!me?.user?.isAList;
  const isAdmin = me?.user?.role === "admin";
  const hasAccess = isAList || isAdmin;

  const { data, isLoading } = useQuery({
    queryKey: ["dfy-dashboard"],
    queryFn: api.alist.getDashboard,
    enabled: hasAccess,
  });

  const { data: workshopsData } = useQuery({
    queryKey: ["workshops"],
    queryFn: api.listWorkshops,
    enabled: hasAccess,
  });

  const user = data?.user;
  const calls: any[] = data?.calls || [];
  const roadmap: any[] = data?.roadmap || [];
  const buildAssets: any[] = data?.buildAssets || [];
  const clientUpdates: any[] = data?.clientUpdates || [];
  const stripeConnection: StripeConnection = data?.stripeConnection || { connected: false };
  const workshops = workshopsData?.workshops || [];

  const currentPhase = (user?.currentDfyPhase ?? 1) as number;
  const [active, setActive] = useState<number>(currentPhase);

  useEffect(() => {
    if (currentPhase) setActive(currentPhase);
  }, [currentPhase]);

  // Per-phase grouping
  const perPhase = useMemo(() => {
    const out: Record<number, { milestones: any[]; assets: any[]; calls: any[] }> = {
      1: { milestones: [], assets: [], calls: [] },
      2: { milestones: [], assets: [], calls: [] },
      3: { milestones: [], assets: [], calls: [] },
      4: { milestones: [], assets: [], calls: [] },
    };
    for (const m of roadmap) {
      const p = (m.phaseNumber as number) || 2;
      if (out[p]) out[p].milestones.push(m);
    }
    for (const a of buildAssets) {
      const p = (a.phaseNumber as number) || 2;
      if (out[p]) out[p].assets.push(a);
    }
    // Crude phase classification for calls based on type/title.
    for (const c of calls) {
      const t = `${c.title || ""} ${c.callType || ""} ${c.description || ""}`.toLowerCase();
      let p = 2;
      if (/(war\s*map|kickoff|onboarding|discovery|strategy)/.test(t)) p = 1;
      else if (/(launch|go\s*live|post[-\s]launch)/.test(t)) p = 3;
      else if (/(workshop)/.test(t)) p = 4;
      out[p].calls.push(c);
    }
    return out;
  }, [roadmap, buildAssets, calls]);

  // Mutations
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["dfy-dashboard"] });

  const setPhaseMut = useMutation({
    mutationFn: ({ userId, phase }: { userId: number; phase: number }) =>
      api.alist.setPhase(userId, phase),
    onSuccess: refresh,
  });
  const addMilestone = useMutation({
    mutationFn: (vars: { userId: number; milestone: string; description?: string; phaseNumber: number; sortOrder: number }) =>
      api.alist.createRoadmap(vars),
    onSuccess: refresh,
  });
  const updateMilestone = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.alist.updateRoadmap(id, { status }),
    onSuccess: refresh,
  });
  const deleteMilestone = useMutation({
    mutationFn: (id: number) => api.alist.deleteRoadmap(id),
    onSuccess: refresh,
  });
  const addAsset = useMutation({
    mutationFn: (data: any) => api.alist.createBuildAsset(data),
    onSuccess: refresh,
  });
  const deleteAsset = useMutation({
    mutationFn: (id: number) => api.alist.deleteBuildAsset(id),
    onSuccess: refresh,
  });
  const postUpdate = useMutation({
    mutationFn: (vars: { userId?: number; kind: string; body: string; title?: string; phaseNumber: number }) =>
      api.alist.createClientUpdate(vars),
    onSuccess: refresh,
  });
  const markUpdate = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.alist.updateClientUpdate(id, { status }),
    onSuccess: refresh,
  });
  const deleteUpdate = useMutation({
    mutationFn: (id: number) => api.alist.deleteClientUpdate(id),
    onSuccess: refresh,
  });

  if (meLoading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center py-32">
          <div className="w-8 h-8 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
        </div>
      </PortalLayout>
    );
  }
  if (!hasAccess) return <LockedView />;

  const activePhase = PHASES.find((p) => p.number === active) || PHASES[0];
  const activeData = perPhase[active];

  return (
    <PortalLayout>
      <div className={`${PORTAL_PAGE_CLASS} space-y-6`}>
        {/* Page header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-5 h-5" style={{ color: GOLD }} />
              <p
                className="text-[10px] font-bold uppercase tracking-[0.22em]"
                style={{ color: GOLD }}
              >
                Done For You / Private Build Hub
              </p>
            </div>
            <h1
              className="text-[34px] sm:text-[44px] md:text-[52px] font-bold uppercase tracking-tight leading-[0.95] [text-wrap:balance]"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              <GoldFoilTitle>
                Welcome Back, {user?.firstName || "Champion"}
              </GoldFoilTitle>
            </h1>
            <p className="text-[13px] sm:text-[14px] text-white/60 mt-2 max-w-xl">
              Your build, your team, your launch. Track every phase, deliverable and conversation in one place.
            </p>
          </div>
          {user?.aListJoinedAt && (
            <div
              className="flex items-center gap-2 text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-full border"
              style={{
                color: GOLD,
                borderColor: `${GOLD}33`,
                background: "rgba(201,164,76,0.05)",
              }}
            >
              <Calendar className="w-3.5 h-3.5" />
              Member since{" "}
              {new Date(user.aListJoinedAt).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              })}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Pipeline / phase stepper */}
            <PhaseStepper
              current={currentPhase}
              active={active}
              onSelect={setActive}
              perPhase={perPhase}
            />

            {/* Admin: change current phase */}
            {isAdmin && user && (
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <span className="text-white/45 uppercase tracking-wider font-bold">
                  Admin / Set Current Phase
                </span>
                {[1, 2, 3, 4].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPhaseMut.mutate({ userId: user.id, phase: p })}
                    disabled={setPhaseMut.isPending}
                    className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                      currentPhase === p ? "text-black" : "text-white/55 hover:text-white"
                    }`}
                    style={
                      currentPhase === p
                        ? { background: "linear-gradient(135deg, #FFD700, #C9A44C)" }
                        : { border: "1px solid rgba(255,255,255,0.1)" }
                    }
                    data-testid={`set-phase-${p}`}
                  >
                    Phase {p}
                  </button>
                ))}
              </div>
            )}

            {/* Active phase hero */}
            <PhaseHero
              phase={activePhase}
              isCurrent={currentPhase === active}
              milestones={activeData.milestones}
              assets={activeData.assets}
              calls={activeData.calls}
            />

            {/* Two-column layout: main content + updates rail */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
              <div className="space-y-6 min-w-0">
                {/* Milestones */}
                <PhaseMilestones
                  items={activeData.milestones}
                  isAdmin={isAdmin}
                  onAdd={(payload) => {
                    if (!user) return;
                    const sortOrder =
                      (activeData.milestones[activeData.milestones.length - 1]?.sortOrder || 0) + 10;
                    addMilestone.mutate({
                      userId: user.id,
                      milestone: payload.milestone,
                      description: payload.description,
                      phaseNumber: active,
                      sortOrder,
                    } as any);
                  }}
                  onToggle={(id, status) => updateMilestone.mutate({ id, status })}
                  onDelete={(id) => deleteMilestone.mutate(id)}
                />

                {/* Assets */}
                <PhaseAssets
                  items={activeData.assets}
                  phaseNumber={active}
                  isAdmin={isAdmin}
                  onAdd={(payload) => {
                    if (!user) return;
                    addAsset.mutate({ ...payload, userId: user.id });
                  }}
                  onDelete={(id) => deleteAsset.mutate(id)}
                />

                {/* Calls or workshops */}
                {active === 4 ? (
                  <WorkshopsList workshops={workshops} />
                ) : (
                  <PhaseCalls items={activeData.calls} />
                )}

                {/* Stripe (admin only, on phase 3 and 4) */}
                {isAdmin && (active === 3 || active === 4) && (
                  <StripeConnectMini connection={stripeConnection} onChanged={refresh} />
                )}
              </div>

              {/* Right rail: updates + support */}
              <div className="space-y-4 lg:sticky lg:top-6 self-start">
                <UpdatesChannel
                  updates={clientUpdates}
                  isAdmin={isAdmin}
                  myUserId={user?.id || 0}
                  targetUserId={user?.id || 0}
                  phaseNumber={active}
                  onPost={(payload) => {
                    if (!user) return;
                    postUpdate.mutate({
                      userId: user.id,
                      kind: payload.kind,
                      body: payload.body,
                      title: payload.title,
                      phaseNumber: active,
                    });
                  }}
                  onMark={(id, status) => markUpdate.mutate({ id, status })}
                  onDelete={(id) => deleteUpdate.mutate(id)}
                />
                <SupportCard />
              </div>
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  );
}
