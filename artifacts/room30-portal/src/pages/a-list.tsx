import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { api } from "@/lib/api";
import {
  Crown,
  Phone,
  CheckCircle2,
  Circle,
  MapPin,
  Calendar,
  Clock,
  Play,
  Target,
  Flame,
  Star,
  ArrowRight,
  ExternalLink,
  MessageCircle,
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
} from "lucide-react";

type StripeConnection = {
  connected: boolean;
  maskedKey?: string;
  accountLabel?: string | null;
  syncStatus?: string;
  lastSyncError?: string | null;
  lastSyncAt?: string | null;
};

function AListLocked() {
  return (
    <PortalLayout>
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="max-w-2xl text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-yellow-400/20 to-yellow-600/10 flex items-center justify-center ring-2 ring-yellow-500/30">
            <Crown className="w-10 h-10 text-yellow-400" />
          </div>
          <h1
            className="text-[32px] md:text-[42px] font-bold uppercase leading-tight mb-3"
            style={{
              fontFamily: "var(--app-font-display)",
              background: "linear-gradient(135deg, #FFD700, #FFA500, #FFD700)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Done For You
          </h1>
          <p className="text-[15px] text-white/60 mb-2 leading-relaxed">
            $15K productized build — we sit down with you for a War Map call,
            then our team builds your funnel, ads, emails and onboarding for
            you, and stays on through launch.
          </p>
          <p className="text-[13px] text-white/55 mb-8">
            Three phases, fixed scope, fixed price. By application only.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8 text-left">
            <div className="bg-white/[0.03] border border-yellow-500/15 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <MapIcon className="w-4 h-4 text-yellow-400" />
                <p className="text-[11px] font-bold uppercase tracking-wider text-yellow-400/80">Phase 1</p>
              </div>
              <p className="text-[13px] font-semibold text-white">War Map</p>
              <p className="text-[11px] text-white/55 mt-1">A working session to lock the offer, the math and the plan.</p>
            </div>
            <div className="bg-white/[0.03] border border-yellow-500/15 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Hammer className="w-4 h-4 text-yellow-400" />
                <p className="text-[11px] font-bold uppercase tracking-wider text-yellow-400/80">Phase 2</p>
              </div>
              <p className="text-[13px] font-semibold text-white">Build</p>
              <p className="text-[11px] text-white/55 mt-1">We build the funnel, ads, emails and automations for you.</p>
            </div>
            <div className="bg-white/[0.03] border border-yellow-500/15 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Rocket className="w-4 h-4 text-yellow-400" />
                <p className="text-[11px] font-bold uppercase tracking-wider text-yellow-400/80">Phase 3</p>
              </div>
              <p className="text-[13px] font-semibold text-white">Launch &amp; Support</p>
              <p className="text-[11px] text-white/55 mt-1">We push it live and stay with you through the first wins.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-8">
            {[
              { icon: Phone, label: "1-on-1 Build Calls" },
              { icon: Folder, label: "Build Asset Library" },
              { icon: Star, label: "Workshop Replays" },
              { icon: Flame, label: "Priority Support" },
            ].map((item) => (
              <div
                key={item.label}
                className="bg-white/[0.03] border border-yellow-500/10 rounded-lg p-3 flex items-center gap-2"
              >
                <item.icon className="w-4 h-4 text-yellow-400 shrink-0" />
                <span className="text-[12px] text-white/65">{item.label}</span>
              </div>
            ))}
          </div>

          <a
            href="https://www.cookemedia.io/done-for-you"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-lg text-[14px] font-bold text-black uppercase tracking-wider transition-all hover:scale-105"
            style={{
              background: "linear-gradient(135deg, #FFD700, #FFA500)",
              fontFamily: "var(--app-font-display)",
            }}
          >
            Apply for Done-For-You
            <ArrowRight className="w-5 h-5" />
          </a>

          <p className="text-[11px] text-white/45 mt-4">
            Questions? Ask in the support chat in the bottom right corner.
          </p>
        </div>
      </div>
    </PortalLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    pending: { bg: "bg-yellow-500/15", text: "text-yellow-400" },
    "in-progress": { bg: "bg-blue-500/15", text: "text-blue-400" },
    completed: { bg: "bg-green-500/15", text: "text-green-400" },
    upcoming: { bg: "bg-white/[0.06]", text: "text-white/65" },
    ready: { bg: "bg-green-500/15", text: "text-green-400" },
    "needs-review": { bg: "bg-amber-500/15", text: "text-amber-400" },
  };
  const c = config[status] || config.pending;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${c.bg} ${c.text}`}>
      {status}
    </span>
  );
}

function PhaseCard({
  phaseNumber,
  title,
  subtitle,
  icon: Icon,
  items,
  description,
}: {
  phaseNumber: number;
  title: string;
  subtitle: string;
  icon: any;
  description: string;
  items: { milestone: string; status: string; description: string | null; targetDate: string | null }[];
}) {
  const completed = items.filter((i) => i.status === "completed").length;
  const inProgress = items.find((i) => i.status === "in-progress");
  const total = items.length;

  return (
    <div
      className="rounded-2xl p-[1px]"
      style={{
        background: "linear-gradient(180deg, rgba(201,164,76,0.45) 0%, rgba(201,164,76,0.1) 50%, rgba(201,164,76,0.3) 100%)",
      }}
    >
      <div className="rounded-2xl bg-[#0F0F0F] p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: "linear-gradient(135deg, rgba(255,215,0,0.18), rgba(255,165,0,0.06))",
                border: "1px solid rgba(201,164,76,0.35)",
              }}
            >
              <Icon className="w-5 h-5 text-yellow-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-yellow-400/80">
                Phase {phaseNumber}
              </p>
              <h3 className="text-[18px] font-bold text-white leading-tight" style={{ fontFamily: "var(--app-font-display)" }}>
                {title}
              </h3>
              <p className="text-[12px] text-white/55 mt-0.5">{subtitle}</p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] text-white/45 uppercase tracking-wider">Done</p>
            <p className="text-[20px] font-bold text-yellow-400 leading-none" style={{ fontFamily: "var(--app-font-display)" }}>
              {completed}<span className="text-white/35 text-[14px]">/{total || "—"}</span>
            </p>
          </div>
        </div>

        <p className="text-[12.5px] text-white/55 mb-4 leading-relaxed">{description}</p>

        {total === 0 ? (
          <p className="text-[12px] text-white/40 italic">
            No milestones added yet. Your team will populate this phase as it
            kicks off.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]"
              >
                <div
                  className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center mt-0.5 ${
                    item.status === "completed"
                      ? "bg-green-500/20 ring-1 ring-green-500/30"
                      : item.status === "in-progress"
                      ? "bg-yellow-500/20 ring-1 ring-yellow-500/30"
                      : "bg-white/[0.06]"
                  }`}
                >
                  {item.status === "completed" ? (
                    <CheckCircle2 className="w-3 h-3 text-green-400" />
                  ) : item.status === "in-progress" ? (
                    <Flame className="w-3 h-3 text-yellow-400" />
                  ) : (
                    <Circle className="w-3 h-3 text-white/45" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p
                      className={`text-[12.5px] font-medium ${
                        item.status === "completed" ? "text-white/65" : "text-white"
                      }`}
                    >
                      {item.milestone}
                    </p>
                    <StatusBadge status={item.status} />
                  </div>
                  {item.description && (
                    <p className="text-[11px] text-white/55 mt-0.5">{item.description}</p>
                  )}
                  {item.targetDate && (
                    <p className="text-[10px] text-white/45 mt-0.5">
                      Target: {new Date(item.targetDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {inProgress && (
          <div className="mt-3 pt-3 border-t border-white/[0.04] text-[11px] text-yellow-400/80 flex items-center gap-1">
            <Flame className="w-3 h-3" /> In progress: {inProgress.milestone}
          </div>
        )}
      </div>
    </div>
  );
}

function StripeConnectCard({
  connection,
  onConnected,
}: {
  connection: StripeConnection;
  onConnected: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectMutation = useMutation({
    mutationFn: () => api.alist.connectStripe(apiKey.trim(), label.trim() || undefined),
    onSuccess: () => {
      setOpen(false);
      setApiKey("");
      setLabel("");
      setError(null);
      onConnected();
    },
    onError: (e: any) => setError(e?.message || "Failed to connect"),
    onSettled: () => setSubmitting(false),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.alist.disconnectStripe(),
    onSuccess: () => onConnected(),
  });

  const handleSubmit = () => {
    setError(null);
    if (!apiKey.trim()) {
      setError("Stripe restricted key is required");
      return;
    }
    setSubmitting(true);
    connectMutation.mutate();
  };

  return (
    <div
      className="rounded-2xl p-[1px]"
      style={{
        background: "linear-gradient(180deg, rgba(201,164,76,0.4) 0%, rgba(201,164,76,0.08) 100%)",
      }}
    >
      <div className="rounded-2xl bg-[#0F0F0F] p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,165,0,0.05))",
                border: "1px solid rgba(201,164,76,0.3)",
              }}
            >
              <CreditCard className="w-4 h-4 text-yellow-400" />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
                Stripe Revenue Tracking
              </h3>
              <p className="text-[12px] text-white/55">
                Read-only — we use this to report your weekly revenue back to
                you on calls.
              </p>
            </div>
          </div>
          {connection.connected && connection.syncStatus === "ok" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-green-500/15 text-green-400 shrink-0">
              <ShieldCheck className="w-3 h-3" /> Connected
            </span>
          )}
          {connection.connected && connection.syncStatus === "auth_failed" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400 shrink-0">
              <AlertTriangle className="w-3 h-3" /> Key Rejected
            </span>
          )}
        </div>

        {connection.connected ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/65">
              <div>
                <span className="text-white/45">Key: </span>
                <span className="font-mono text-yellow-400/80">{connection.maskedKey}</span>
              </div>
              {connection.accountLabel && (
                <div>
                  <span className="text-white/45">Account: </span>
                  <span>{connection.accountLabel}</span>
                </div>
              )}
              {connection.lastSyncAt && (
                <div>
                  <span className="text-white/45">Last sync: </span>
                  <span>{new Date(connection.lastSyncAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
            {connection.syncStatus === "auth_failed" && connection.lastSyncError && (
              <p className="text-[11px] text-red-400/80">{connection.lastSyncError}</p>
            )}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setOpen(true)}
                className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded border border-white/[0.1] text-white/65 hover:text-yellow-400 hover:border-yellow-500/30 transition-colors"
              >
                Replace Key
              </button>
              <button
                onClick={() => {
                  if (confirm("Disconnect Stripe? Revenue tracking will stop.")) {
                    disconnectMutation.mutate();
                  }
                }}
                disabled={disconnectMutation.isPending}
                className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded border border-white/[0.1] text-white/55 hover:text-red-400 hover:border-red-500/30 transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[12.5px] font-bold text-black uppercase tracking-wider transition-all hover:scale-[1.02]"
            style={{
              background: "linear-gradient(135deg, #FFD700, #FFA500)",
              fontFamily: "var(--app-font-display)",
            }}
          >
            <CreditCard className="w-4 h-4" />
            Connect Stripe
          </button>
        )}

        {open && (
          <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-white/55 mb-1 block">
                Stripe Restricted API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="rk_live_..."
                className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[13px] text-white placeholder:text-white/30 font-mono focus:outline-none focus:border-yellow-500/40"
              />
              <p className="text-[10px] text-white/45 mt-1">
                Use a <strong>restricted</strong> key (starts with{" "}
                <span className="font-mono text-yellow-400/80">rk_live_</span>) with read-only Charges access.
              </p>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-white/55 mb-1 block">
                Account Label (optional)
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Main brand, LLC #2"
                className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/40"
              />
            </div>
            {error && <p className="text-[12px] text-red-400">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                disabled={submitting}
                className="px-3 py-1.5 text-[12px] font-medium text-white/65 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-[12px] font-bold text-black uppercase tracking-wider"
                style={{
                  background: "linear-gradient(135deg, #FFD700, #FFA500)",
                  fontFamily: "var(--app-font-display)",
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Key
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SupportBanner() {
  return (
    <div
      className="block rounded-xl p-4 border border-yellow-500/20"
      style={{
        background: "linear-gradient(135deg, rgba(255,215,0,0.06), rgba(255,165,0,0.02))",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: "linear-gradient(135deg, rgba(255,215,0,0.18), rgba(255,165,0,0.06))",
            border: "1px solid rgba(201,164,76,0.35)",
          }}
        >
          <MessageCircle className="w-4 h-4 text-yellow-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-white">
            Need help? Message your DFY team
          </p>
          <p className="text-[12px] text-white/55">
            Open the support chat in the bottom right corner and the team will
            pick it up from there.
          </p>
        </div>
      </div>
    </div>
  );
}

function CategoryIcon({ category }: { category: string }) {
  const c = category.toLowerCase();
  if (c.includes("doc") || c.includes("brief")) return <FileText className="w-3.5 h-3.5" />;
  if (c.includes("link")) return <LinkIcon className="w-3.5 h-3.5" />;
  return <Folder className="w-3.5 h-3.5" />;
}

export default function AList() {
  const queryClient = useQueryClient();

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.getMe,
  });

  const isAList = !!me?.user?.isAList;
  const isAdmin = me?.user?.role === "admin";
  const hasAccess = isAList || isAdmin;

  const { data, isLoading } = useQuery({
    queryKey: ["a-list-dashboard"],
    queryFn: api.alist.getDashboard,
    enabled: hasAccess,
  });

  const { data: workshopsData } = useQuery({
    queryKey: ["workshops"],
    queryFn: api.listWorkshops,
    enabled: hasAccess,
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

  if (!hasAccess) {
    return <AListLocked />;
  }

  const user = data?.user;
  const calls: any[] = data?.calls || [];
  const roadmap: any[] = data?.roadmap || [];
  const buildAssets: any[] = data?.buildAssets || [];
  const stats = data?.stats;
  const stripeConnection: StripeConnection = data?.stripeConnection || { connected: false };
  const workshops = workshopsData?.workshops || [];

  // Phase classification: Phase 1 = War Map; Phase 2 = Build; Phase 3 = Launch.
  // Milestones don't have a phase column, so we infer from a simple keyword
  // match. Anything we can't classify falls into the active build phase so
  // it stays visible.
  const classifyPhase = (m: any): 1 | 2 | 3 => {
    const t = `${m.milestone || ""} ${m.description || ""}`.toLowerCase();
    if (/(war\s*map|kickoff|onboarding|discovery|strategy)/.test(t)) return 1;
    if (/(launch|go\s*live|support|post[-\s]launch|stabili[sz]e|wins)/.test(t)) return 3;
    return 2;
  };
  const phase1Items = roadmap.filter((m) => classifyPhase(m) === 1);
  const phase2Items = roadmap.filter((m) => classifyPhase(m) === 2);
  const phase3Items = roadmap.filter((m) => classifyPhase(m) === 3);

  const recordedCalls = calls.filter((c) => !!c.recordingUrl);

  // Workshops: split into upcoming vs past so the "recordings" list is clear.
  const now = Date.now();
  const sortedWorkshops = [...workshops].sort(
    (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime()
  );
  const pastWorkshops = sortedWorkshops.filter((w) => new Date(w.startsAt).getTime() < now);
  const upcomingWorkshops = [...sortedWorkshops]
    .filter((w) => new Date(w.startsAt).getTime() >= now)
    .reverse();
  const nextWorkshop = upcomingWorkshops[0];

  const refetchDashboard = () => queryClient.invalidateQueries({ queryKey: ["a-list-dashboard"] });

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-yellow-400/20 to-yellow-600/10 flex items-center justify-center ring-1 ring-yellow-500/30">
                <Crown className="w-4 h-4 text-yellow-400" />
              </div>
              <h1
                className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] leading-tight"
                style={{
                  fontFamily: "var(--app-font-display)",
                  background: "linear-gradient(135deg, #FFD700, #FFA500, #FFD700)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                Done For You
              </h1>
            </div>
            <p className="text-[14px] text-white/65">
              Your private build hub. Welcome back, {user?.firstName || "Champion"}.
            </p>
          </div>
          {user?.aListJoinedAt && (
            <div className="flex items-center gap-2 text-[12px] text-yellow-400/60">
              <Calendar className="w-3.5 h-3.5" />
              Member since{" "}
              {new Date(user.aListJoinedAt).toLocaleDateString("en-US", {
                month: "long",
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
          <div className="space-y-8">
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white/[0.03] border border-yellow-500/10 rounded-xl p-4">
                <MapIcon className="w-4 h-4 text-yellow-400 mb-2" />
                <p className="text-[24px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
                  {stats?.completedMilestones || 0}/{stats?.totalMilestones || 0}
                </p>
                <p className="text-[11px] text-white/55 uppercase tracking-wider">Roadmap</p>
              </div>
              <div className="bg-white/[0.03] border border-yellow-500/10 rounded-xl p-4">
                <Phone className="w-4 h-4 text-yellow-400 mb-2" />
                <p className="text-[24px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
                  {stats?.totalCalls || 0}
                </p>
                <p className="text-[11px] text-white/55 uppercase tracking-wider">Calls</p>
              </div>
              <div className="bg-white/[0.03] border border-yellow-500/10 rounded-xl p-4">
                <Folder className="w-4 h-4 text-yellow-400 mb-2" />
                <p className="text-[24px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
                  {stats?.totalBuildAssets || 0}
                </p>
                <p className="text-[11px] text-white/55 uppercase tracking-wider">Build Assets</p>
              </div>
              <div className="bg-white/[0.03] border border-yellow-500/10 rounded-xl p-4">
                <Star className="w-4 h-4 text-yellow-400 mb-2" />
                <p className="text-[24px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
                  {pastWorkshops.length}
                </p>
                <p className="text-[11px] text-white/55 uppercase tracking-wider">Workshop Replays</p>
              </div>
            </div>

            {/* Support banner */}
            <SupportBanner />

            {/* 3-Phase roadmap */}
            <section>
              <h2
                className="text-[16px] font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                <MapIcon className="w-4 h-4 text-yellow-400" />
                Build Roadmap
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <PhaseCard
                  phaseNumber={1}
                  title="War Map"
                  subtitle="Strategy & blueprint"
                  icon={MapIcon}
                  description="A working session to lock the offer, the math and the exact build plan before any code or copy is written."
                  items={phase1Items}
                />
                <PhaseCard
                  phaseNumber={2}
                  title="Build"
                  subtitle="We do the work"
                  icon={Hammer}
                  description="Funnel, ads, emails, automations and onboarding — built for you by our team to spec from the War Map."
                  items={phase2Items}
                />
                <PhaseCard
                  phaseNumber={3}
                  title="Launch & Support"
                  subtitle="Going live, dialing in"
                  icon={Rocket}
                  description="We push it live, watch the first cohort of buyers come through, and stay close until you have predictable revenue."
                  items={phase3Items}
                />
              </div>
            </section>

            {/* Workshops */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2
                  className="text-[16px] font-bold text-white uppercase tracking-wider flex items-center gap-2"
                  style={{ fontFamily: "var(--app-font-display)" }}
                >
                  <Star className="w-4 h-4 text-yellow-400" />
                  Workshops
                </h2>
              </div>

              {nextWorkshop && (
                <div
                  className="rounded-xl p-4 mb-3 flex items-center gap-3 border border-yellow-500/20"
                  style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.06), rgba(255,165,0,0.02))" }}
                >
                  <div className="w-9 h-9 rounded-lg bg-yellow-500/15 flex items-center justify-center shrink-0">
                    <Video className="w-4 h-4 text-yellow-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-yellow-400/80">Next live workshop</p>
                    <p className="text-[14px] font-semibold text-white truncate">{nextWorkshop.title}</p>
                    <p className="text-[11px] text-white/55">
                      {new Date(nextWorkshop.startsAt).toLocaleString(undefined, {
                        weekday: "short", month: "short", day: "numeric",
                        hour: "numeric", minute: "2-digit",
                      })}
                      {" · "}{nextWorkshop.durationMinutes} min
                    </p>
                  </div>
                  <a
                    href={nextWorkshop.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold text-black"
                    style={{ background: "linear-gradient(135deg, #FFD700, #FFA500)" }}
                  >
                    Join <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {pastWorkshops.length === 0 && !nextWorkshop ? (
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-8 text-center">
                  <Star className="w-8 h-8 text-white/10 mx-auto mb-3" />
                  <p className="text-[13px] text-white/55">No workshops scheduled yet</p>
                  <p className="text-[11px] text-white/45 mt-1">Recordings will appear here once workshops are held.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {pastWorkshops.map((w) => (
                    <div
                      key={w.id}
                      className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 hover:border-yellow-500/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-medium text-white truncate">{w.title}</p>
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
                            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                          >
                            <Play className="w-3 h-3" /> Watch Replay
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

            {/* 1-on-1 call recordings */}
            <section>
              <h2
                className="text-[16px] font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                <Phone className="w-4 h-4 text-yellow-400" />
                1-on-1 Call Recordings
              </h2>
              {calls.length === 0 ? (
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-8 text-center">
                  <Phone className="w-8 h-8 text-white/10 mx-auto mb-3" />
                  <p className="text-[13px] text-white/55">No calls recorded yet</p>
                  <p className="text-[11px] text-white/45 mt-1">Your build calls and War Map session will appear here.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {calls.map((call: any) => (
                    <div
                      key={call.id}
                      className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 hover:border-yellow-500/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-medium text-white truncate">{call.title}</p>
                          {call.description && (
                            <p className="text-[12px] text-white/65 mt-1 line-clamp-2">{call.description}</p>
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
                            <span className="px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400/70 text-[10px] uppercase">
                              {call.callType}
                            </span>
                          </div>
                        </div>
                        {call.recordingUrl ? (
                          <a
                            href={call.recordingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                          >
                            <Play className="w-3 h-3" /> Recording
                          </a>
                        ) : null}
                      </div>
                      {call.notes && (
                        <div className="mt-3 pt-3 border-t border-white/[0.04]">
                          <p className="text-[11px] text-white/55 uppercase tracking-wider mb-1">Notes</p>
                          <p className="text-[12px] text-white/55 whitespace-pre-wrap">{call.notes}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {calls.length > 0 && recordedCalls.length === 0 && (
                <p className="text-[11px] text-white/40 mt-2 italic">
                  Recordings will be uploaded by your team after each call.
                </p>
              )}
            </section>

            {/* Build assets */}
            <section>
              <h2
                className="text-[16px] font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                <Folder className="w-4 h-4 text-yellow-400" />
                Build Assets
              </h2>
              {buildAssets.length === 0 ? (
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-8 text-center">
                  <Folder className="w-8 h-8 text-white/10 mx-auto mb-3" />
                  <p className="text-[13px] text-white/55">No build assets yet</p>
                  <p className="text-[11px] text-white/45 mt-1">
                    Funnel pages, ad creatives, emails and other deliverables will land here as they're built.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {buildAssets.map((a: any) => (
                    <div
                      key={a.id}
                      className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 hover:border-yellow-500/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-yellow-400/80 bg-yellow-500/10 px-1.5 py-0.5 rounded">
                            <CategoryIcon category={a.category} />
                            {a.category}
                          </span>
                          <StatusBadge status={a.status} />
                        </div>
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
                          className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-bold uppercase tracking-wider text-yellow-400 hover:text-yellow-300"
                        >
                          Open <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Stripe connect */}
            <section>
              <StripeConnectCard
                connection={stripeConnection}
                onConnected={refetchDashboard}
              />
            </section>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
