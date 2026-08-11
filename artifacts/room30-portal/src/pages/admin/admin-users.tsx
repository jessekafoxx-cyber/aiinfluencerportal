import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api, setImpersonation } from "@/lib/api";
import { Eye } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { AdminLayout } from "@/components/admin-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { AdminDfyPanel } from "@/components/admin-dfy-panel";
import {
  Shield,
  ChevronDown,
  Crown,
  UserPlus,
  Users as UsersIcon,
  Check,
  X,
  Loader2,
  Mail,
  Lock,
  Pencil,
  KeyRound,
  Trash2,
  Receipt,
  Activity as ActivityIcon,
  AlertTriangle,
  Save,
  Search,
} from "lucide-react";
import { useState, useEffect, Fragment, useMemo } from "react";
import {
  TEAM_CAPABILITIES,
  CAPABILITY_META,
  TEAM_ROLE_PRESETS,
  sanitizeCapabilities,
  isTeamRoleKey,
  hasCapability,
  type TeamCapability,
  type TeamRoleKey,
} from "@/lib/capabilities";

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

type RoleKey = "student" | "team" | "admin";

const ROLE_META: Record<RoleKey, { label: string; pillClass: string; Icon: typeof Shield }> = {
  student: {
    label: "Student",
    pillClass: "bg-white/[0.06] text-white/60",
    Icon: UsersIcon,
  },
  team: {
    label: "Team Member",
    pillClass: "bg-blue-500/15 text-blue-300",
    Icon: UsersIcon,
  },
  admin: {
    label: "Admin",
    pillClass: "bg-[#C9A44C]/15 text-[#C9A44C]",
    Icon: Shield,
  },
};

// Order matters: this is the order toggles render in the access panel.
// Labels mirror the public-facing product names so admins know what
// they are granting without cross-referencing the product catalogue.
const ACCESS_FLAGS: { key: string; label: string; sub: string; linkedKey?: string }[] = [
  { key: "mainProductPaid", label: "AI Influencer Masterclass", sub: "$27 main offer, manual grant only (real Stripe/GHL purchases are not revoked from here)" },
  { key: "bump1Paid", label: "VSL Vault", sub: "Order bump #1, also unlocked by Our Portfolio upsell" },
  { key: "bump2Paid", label: "Daily Ad Research Board", sub: "Order bump #2" },
  { key: "bump3Paid", label: "IG Follower Hijack", sub: "Order bump #3" },
  { key: "upsell1Paid", label: "Greg AI Monthly", sub: "Upsell 1, unlocks the marketing tool" },
  { key: "upsell2Paid", label: "Our Portfolio (47 products + 5 AI Influencers)", sub: "$297 (auto-syncs from Stripe purchases; toggle on to grant manually; also satisfies VSL Vault)", linkedKey: "portfolioPaid" },
  { key: "upsell3Paid", label: "Platinum Club", sub: "$97/mo subscription (auto-syncs from Stripe purchases; toggle on to grant manually)", linkedKey: "platinumPaid" },
  { key: "downsell1Paid", label: "Greg AI 7-Day Trial", sub: "Downsell of upsell 1" },
  // New sidebar add-ons. The TikTok masterclass ships in the order bump
  // #3 bundle; the other four are admin-grant only until their Stripe
  // pricing lands.
  { key: "tiktokSlideshowPaid", label: "TikTok AI Slideshow Masterclass", sub: "Order bump #3, bundled with IG Follower Hijack (legacy comp flag)" },
  { key: "hookDemoPaid", label: "2,000 Hook Library", sub: "Legacy/standalone flag, manual grant only for now (the live 2,000 Hook Library is unlocked by order bump #2)" },
  { key: "doneForYouPackPaid", label: "Done For You Pack", sub: "$197 (auto-syncs from Stripe funnel purchases; toggle on to grant manually; also writes the funnel upsell1Paid flag)", linkedKey: "upsell1Paid" },
];

export function AdminUsers() {
  const queryClient = useQueryClient();
  const { data: users, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: api.admin.getUsers,
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) =>
      api.admin.updateUserRole(userId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const aListMutation = useMutation({
    mutationFn: ({ userId, isAList }: { userId: number; isAList: boolean }) =>
      api.admin.toggleAList(userId, isAList),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [, setLocation] = useLocation();

  // Task #710: super-admin "view as user" impersonation. Per-row + global
  // picker both route through this single helper so the audit trail is
  // identical regardless of entry point.
  async function startImpersonation(target: {
    id: number;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }) {
    try {
      const res = await api.admin.startImpersonation(target.id);
      setImpersonation(res.token, {
        sessionId: res.sessionId,
        expiresAt: res.expiresAt,
        target: {
          id: res.target.id,
          email: res.target.email,
          firstName: res.target.firstName ?? null,
          lastName: res.target.lastName ?? null,
        },
        admin: { clerkId: res.admin.clerkId, email: res.admin.email ?? null },
      });
      // Force the portal /me cache to refetch under the new identity so
      // the sidebar entitlements, name, and avatar swap immediately.
      await queryClient.invalidateQueries();
      const name =
        [target.firstName, target.lastName].filter(Boolean).join(" ") ||
        target.email ||
        `User #${target.id}`;
      toast({
        title: "Viewing as user",
        description: `${name} — read-only. Click Exit in the banner to return.`,
      });
      setLocation("/dashboard");
    } catch (err: any) {
      toast({
        title: "Could not start impersonation",
        description: err?.message || "Unknown error",
        variant: "destructive" as any,
      });
    }
  }

  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 275);
  // Customers vs Team split. Customers = students; Team = team members + admins.
  const [activeTab, setActiveTab] = useState<"customers" | "team">("customers");
  const filteredUsers = useMemo(() => {
    if (!users) return users;
    const q = debouncedSearch.trim().toLowerCase();
    return users.filter(
      (u: { email?: string; firstName?: string; lastName?: string; role?: string }) => {
        const isStaff = u.role === "team" || u.role === "admin";
        if (activeTab === "team" ? !isStaff : isStaff) return false;
        if (!q) return true;
        const email = (u.email || "").toLowerCase();
        const first = (u.firstName || "").toLowerCase();
        const last = (u.lastName || "").toLowerCase();
        return email.includes(q) || first.includes(q) || last.includes(q);
      },
    );
  }, [users, debouncedSearch, activeTab]);

  const customerCount = useMemo(
    () =>
      (users || []).filter(
        (u: { role?: string }) => u.role !== "team" && u.role !== "admin",
      ).length,
    [users],
  );
  const teamCount = useMemo(
    () =>
      (users || []).filter(
        (u: { role?: string }) => u.role === "team" || u.role === "admin",
      ).length,
    [users],
  );

  // Read super-admin status so the Admin role button can be locked
  // for portal admins who are not the env-pinned owner.
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const isSuperAdmin = !!(me?.user as any)?.isSuperAdmin;
  // Task #796: capability-aware UI gating. An admin (or env-pinned owner)
  // holds every capability implicitly; a "team" member holds only what is in
  // their granular permissions list. Team management (creating staff, role
  // changes, editing capabilities) stays admin-only; the per-capability gates
  // (impersonate, invite) drive which staff tools each team member sees.
  const isAdmin = isSuperAdmin || (me?.user as any)?.role === "admin";
  const canImpersonate = hasCapability(
    (me?.user as any) ?? null,
    "users.impersonate",
    isSuperAdmin,
  );
  const canInvite = hasCapability(
    (me?.user as any) ?? null,
    "users.invite",
    isSuperAdmin,
  );

  // Add Member form state
  const [showInvite, setShowInvite] = useState(false);
  const [addMode, setAddMode] = useState<"invite" | "manual">("invite");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"student" | "team" | "admin">("student");
  const [inviteGrants, setInviteGrants] = useState<Record<string, boolean>>({});
  const [inviteResult, setInviteResult] = useState<{ ok: boolean; msg: string } | null>(null);
  // Manual-add extra fields
  const [manualFirstName, setManualFirstName] = useState("");
  const [manualLastName, setManualLastName] = useState("");
  // Team-role preset + capabilities, only used when inviteRole === "team".
  const [inviteTeamRole, setInviteTeamRole] = useState<TeamRoleKey>(
    "customer_support_specialist",
  );
  const [inviteCaps, setInviteCaps] = useState<TeamCapability[]>(
    TEAM_ROLE_PRESETS.customer_support_specialist.capabilities,
  );

  function applyTeamPreset(preset: TeamRoleKey) {
    setInviteTeamRole(preset);
    if (preset !== "custom") {
      setInviteCaps([...TEAM_ROLE_PRESETS[preset].capabilities]);
    }
  }

  function toggleInviteCap(cap: TeamCapability) {
    setInviteTeamRole("custom");
    setInviteCaps((caps) =>
      caps.includes(cap) ? caps.filter((c) => c !== cap) : [...caps, cap],
    );
  }

  function resetInviteForm() {
    setInviteEmail("");
    setInviteRole("student");
    setInviteGrants({});
    setInviteResult(null);
    setManualFirstName("");
    setManualLastName("");
    setInviteTeamRole("customer_support_specialist");
    setInviteCaps([...TEAM_ROLE_PRESETS.customer_support_specialist.capabilities]);
  }

  const manualMutation = useMutation({
    mutationFn: () =>
      api.admin.createManualUser({
        email: inviteEmail.trim().toLowerCase(),
        firstName: manualFirstName.trim() || undefined,
        lastName: manualLastName.trim() || undefined,
        role: inviteRole,
        grants: inviteGrants,
        ...(inviteRole === "team"
          ? { team: { teamRole: inviteTeamRole, permissions: inviteCaps } }
          : {}),
      }),
    onSuccess: (data: any) => {
      setInviteResult({
        ok: true,
        msg: data.created
          ? `Member added: ${inviteEmail}. They'll be linked automatically when they sign up with this email.`
          : `Existing member updated: ${inviteEmail}. Role and access applied.`,
      });
      setInviteEmail("");
      setManualFirstName("");
      setManualLastName("");
      setInviteGrants({});
      setInviteRole("student");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: any) => {
      setInviteResult({ ok: false, msg: err?.message || "Could not add member." });
    },
  });

  function submitManual() {
    setInviteResult(null);
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      setInviteResult({ ok: false, msg: "Enter a valid email." });
      return;
    }
    manualMutation.mutate();
  }

  const inviteMutation = useMutation({
    mutationFn: ({
      email,
      role,
      grants,
      team,
    }: {
      email: string;
      role: "student" | "team" | "admin";
      grants: Record<string, boolean>;
      team?: { teamRole: TeamRoleKey; permissions: TeamCapability[] };
    }) => api.admin.createInvite(email, role, grants, team),
    onSuccess: (data: any) => {
      // The server now returns 200 even when the Resend email send
      // fails, with `emailStatus: "failed"` + a human-readable
      // `emailError`. The invite row + entitlements ARE saved in
      // either case, so this is "succeeded with caveat" not failure.
      if (data?.emailStatus === "failed") {
        setInviteResult({
          ok: false,
          msg: `Invite saved for ${inviteEmail}, but the email did not send: ${data.emailError || "unknown reason"}. Share the signup link with them directly or use Resend invite from the users table.`,
        });
      } else {
        setInviteResult({ ok: true, msg: `Invite sent to ${inviteEmail}.` });
        setInviteEmail("");
        setInviteGrants({});
        setInviteRole("student");
      }
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-invites"] });
    },
    onError: (err: any) => {
      setInviteResult({ ok: false, msg: err?.message || "Could not send invite." });
    },
  });

  function submitInvite() {
    setInviteResult(null);
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      setInviteResult({ ok: false, msg: "Enter a valid email." });
      return;
    }
    inviteMutation.mutate({
      email,
      role: inviteRole,
      grants: inviteGrants,
      ...(inviteRole === "team"
        ? { team: { teamRole: inviteTeamRole, permissions: inviteCaps } }
        : {}),
    });
  }

  return (
    <AdminLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="flex items-end justify-between gap-4 mb-10 flex-wrap">
          <div>
            <p className="text-[12px] text-[#C9A44C] font-bold uppercase tracking-[0.15em] mb-2">
              Admin Panel
            </p>
            <h1
              className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              Manage Users
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {canImpersonate && (
              <button
                onClick={() => setShowPicker(true)}
                title="Search any user and view the portal as them"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#C9A44C]/40 text-[#C9A44C] text-[12px] font-bold uppercase tracking-wider hover:bg-[#C9A44C]/10 transition-all"
              >
                <Eye className="w-4 h-4" />
                View as user…
              </button>
            )}
            {canInvite && (
              <button
                onClick={() => {
                  setShowInvite((v) => !v);
                  setInviteResult(null);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-purple-500 to-purple-600 text-white text-[12px] font-bold uppercase tracking-wider hover:from-purple-400 hover:to-purple-500 transition-all"
              >
                <UserPlus className="w-4 h-4" />
                {showInvite ? "Close" : "Add Member"}
              </button>
            )}
          </div>
        </div>

        {showPicker && canImpersonate && (
          <ViewAsPicker
            users={users ?? []}
            onClose={() => setShowPicker(false)}
            onPick={(u) => {
              setShowPicker(false);
              startImpersonation(u);
            }}
          />
        )}

        {showInvite && (
          <div className="mb-6 bg-[#0f0f0f] border border-white/[0.08] rounded-xl p-5 space-y-5">
            {/* Mode tabs */}
            <div className="flex gap-1 p-1 bg-white/[0.04] rounded-lg w-fit">
              {(["invite", "manual"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => { setAddMode(mode); setInviteResult(null); }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-[12px] font-bold uppercase tracking-wider transition-all ${
                    addMode === mode
                      ? "bg-[#C9A44C] text-black shadow-sm"
                      : "text-white/40 hover:text-white/70"
                  }`}
                >
                  {mode === "invite" ? <Mail className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                  {mode === "invite" ? "Send Invite" : "Add Manually"}
                </button>
              ))}
            </div>

            {/* Mode description */}
            <p className="text-[12px] text-white/40 -mt-2">
              {addMode === "invite"
                ? "Sends a sign-up link to their email. They create their own password."
                : "Creates their account directly — no email sent. They can sign in with this email address straight away."}
            </p>

            {/* Email (shared) */}
            <div>
              <label className="block text-[11px] text-white/55 mb-1.5">Email</label>
              <div className="relative max-w-[420px]">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="person@example.com"
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-black/40 border border-white/[0.1] text-white text-[13px] placeholder-white/30 focus:outline-none focus:border-[#C9A44C]/60"
                />
              </div>
            </div>

            {/* Name fields — manual mode only */}
            {addMode === "manual" && (
              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-[11px] text-white/55 mb-1.5">First name <span className="text-white/25">(optional)</span></label>
                  <input
                    type="text"
                    value={manualFirstName}
                    onChange={(e) => setManualFirstName(e.target.value)}
                    placeholder="Jane"
                    className="w-full px-3 py-2.5 rounded-lg bg-black/40 border border-white/[0.1] text-white text-[13px] placeholder-white/30 focus:outline-none focus:border-[#C9A44C]/60"
                  />
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-[11px] text-white/55 mb-1.5">Last name <span className="text-white/25">(optional)</span></label>
                  <input
                    type="text"
                    value={manualLastName}
                    onChange={(e) => setManualLastName(e.target.value)}
                    placeholder="Smith"
                    className="w-full px-3 py-2.5 rounded-lg bg-black/40 border border-white/[0.1] text-white text-[13px] placeholder-white/30 focus:outline-none focus:border-[#C9A44C]/60"
                  />
                </div>
              </div>
            )}
            

            <div>
              <label className="block text-[11px] text-white/55 mb-1.5">Role</label>
              <div className="flex gap-2 flex-wrap">
                {(["student", "team", "admin"] as const).map((role) => {
                  const isActive = inviteRole === role;
                  // Team management is admin-only: a non-admin inviter (e.g. an
                  // Onboarding Specialist with users.invite) can invite
                  // students but never mint team members or admins.
                  const isLocked =
                    (role === "admin" && !isSuperAdmin) ||
                    (role === "team" && !isAdmin);
                  return (
                    <button
                      key={role}
                      onClick={() => {
                        if (isLocked) return;
                        setInviteRole(role);
                      }}
                      disabled={isLocked}
                      title={
                        isLocked
                          ? role === "admin"
                            ? "Only the portal owner can invite an Admin."
                            : "Only an admin can invite team members."
                          : undefined
                      }
                      className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded border transition-colors inline-flex items-center gap-1.5 ${
                        isActive
                          ? "border-[#C9A44C] bg-[#C9A44C]/10 text-[#C9A44C]"
                          : isLocked
                          ? "border-white/[0.05] text-white/30 cursor-not-allowed"
                          : "border-white/[0.1] text-white/60 hover:text-white hover:border-white/30"
                      }`}
                    >
                      {isLocked && <Lock className="w-3 h-3" />}
                      {ROLE_META[role].label}
                    </button>
                  );
                })}
              </div>
            </div>

            {inviteRole === "team" && (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.04] p-4 space-y-4">
                <div>
                  <label className="block text-[11px] text-white/55 mb-1.5">
                    Team role preset
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {(Object.keys(TEAM_ROLE_PRESETS) as TeamRoleKey[]).map((key) => {
                      const isActive = inviteTeamRole === key;
                      return (
                        <button
                          key={key}
                          onClick={() => applyTeamPreset(key)}
                          title={TEAM_ROLE_PRESETS[key].description}
                          className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded border transition-colors ${
                            isActive
                              ? "border-blue-400 bg-blue-500/15 text-blue-200"
                              : "border-white/[0.1] text-white/60 hover:text-white hover:border-white/30"
                          }`}
                        >
                          {TEAM_ROLE_PRESETS[key].label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-white/45 mt-2">
                    {TEAM_ROLE_PRESETS[inviteTeamRole].description}
                  </p>
                </div>
                <div>
                  <label className="block text-[11px] text-white/55 mb-2">
                    Permissions (what this team member can do)
                  </label>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {TEAM_CAPABILITIES.map((cap) => (
                      <label
                        key={cap}
                        className="flex items-start gap-3 p-3 rounded-lg border border-white/[0.08] bg-black/30 cursor-pointer hover:border-blue-400/40 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={inviteCaps.includes(cap)}
                          onChange={() => toggleInviteCap(cap)}
                          className="mt-0.5 w-4 h-4 accent-blue-400 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-white">
                            {CAPABILITY_META[cap].label}
                          </p>
                          <p className="text-[11px] text-white/45 mt-0.5">
                            {CAPABILITY_META[cap].description}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-white/45 mt-2">
                    Team members never see checkout conversion or analytics - those stay
                    admin-only.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] text-white/55 mb-2">
                Access (tick what they should be able to use)
              </label>
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="flex items-start gap-3 p-3 rounded-lg border border-white/[0.08] bg-black/30 cursor-pointer hover:border-[#C9A44C]/40 transition-colors">
                  <input
                    type="checkbox"
                    checked={inviteGrants.isAList === true}
                    onChange={(e) =>
                      setInviteGrants((g) => ({ ...g, isAList: e.target.checked }))
                    }
                    className="mt-0.5 w-4 h-4 accent-[#C9A44C] cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-white inline-flex items-center gap-1.5">
                      <Crown className="w-3 h-3 text-yellow-400" />
                      Done For You
                    </p>
                    <p className="text-[11px] text-white/45 mt-0.5">
                      Unlocks the VIP coaching workspace.
                    </p>
                  </div>
                </label>
                {ACCESS_FLAGS.map((f) => (
                  <label
                    key={f.key}
                    className="flex items-start gap-3 p-3 rounded-lg border border-white/[0.08] bg-black/30 cursor-pointer hover:border-[#C9A44C]/40 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={inviteGrants[f.key] === true}
                      onChange={(e) =>
                        setInviteGrants((g) => {
                          const next = { ...g, [f.key]: e.target.checked };
                          if (f.linkedKey) next[f.linkedKey] = e.target.checked;
                          return next;
                        })
                      }
                      className="mt-0.5 w-4 h-4 accent-[#C9A44C] cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-white">{f.label}</p>
                      <p className="text-[11px] text-white/45 mt-0.5">{f.sub}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1 flex-wrap">
              <button
                onClick={addMode === "invite" ? submitInvite : submitManual}
                disabled={inviteMutation.isPending || manualMutation.isPending}
                className="px-5 py-2.5 rounded-lg bg-[#C9A44C] text-black text-[12px] font-bold uppercase tracking-wider hover:bg-[#d4b25a] transition-colors disabled:opacity-50 inline-flex items-center gap-2"
              >
                {(inviteMutation.isPending || manualMutation.isPending) ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : addMode === "invite" ? (
                  <Mail className="w-3.5 h-3.5" />
                ) : (
                  <UserPlus className="w-3.5 h-3.5" />
                )}
                {addMode === "invite" ? "Send Invite" : "Add Member"}
              </button>
              <button
                onClick={resetInviteForm}
                disabled={inviteMutation.isPending || manualMutation.isPending}
                className="text-[11px] text-white/55 hover:text-white/80 uppercase tracking-wider"
              >
                Reset
              </button>
            </div>

            {inviteResult && (
              <div
                className={`px-3 py-2 rounded text-[12px] ${
                  inviteResult.ok
                    ? "bg-green-500/10 text-green-300 border border-green-500/20"
                    : "bg-red-500/10 text-red-300 border border-red-500/20"
                }`}
              >
                {inviteResult.msg}
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#C9A44C] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
          <div className="flex items-center gap-2 mb-5 border-b border-white/[0.08]">
            {([
              { key: "customers" as const, label: "Customers", count: customerCount },
              { key: "team" as const, label: "Team", count: teamCount },
            ]).map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key);
                    setExpandedUser(null);
                  }}
                  className={`relative px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider transition-colors -mb-px border-b-2 ${
                    isActive
                      ? "border-[#C9A44C] text-[#C9A44C]"
                      : "border-transparent text-white/55 hover:text-white/80"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${
                      isActive ? "bg-[#C9A44C]/15 text-[#C9A44C]" : "bg-white/[0.06] text-white/50"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mb-4">
            <div className="relative max-w-[420px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by name or email"
                className="w-full pl-10 pr-9 py-2.5 rounded-lg bg-black/40 border border-white/[0.1] text-white text-[13px] placeholder-white/30 focus:outline-none focus:border-[#C9A44C]/60"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-white/40 hover:text-white hover:bg-white/[0.06]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">
                      User
                    </th>
                    <th className="text-left px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">
                      Role
                    </th>
                    <th className="text-left px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">
                      Progress
                    </th>
                    <th className="text-left px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">
                      Joined
                    </th>
                    <th className="text-right px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredUsers && filteredUsers.length === 0 && users && users.length > 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-[13px] text-white/55">
                        No users match "{debouncedSearch}".
                      </td>
                    </tr>
                  )}
                  {filteredUsers?.map((u: any) => {
                    const roleKey: RoleKey = (["student", "team", "admin"] as const).includes(u.role)
                      ? (u.role as RoleKey)
                      : "student";
                    const meta = ROLE_META[roleKey];
                    const isOpen = expandedUser === u.id;
                    const expandedUserData = isOpen ? u : null;
                    return (
                      <Fragment key={u.id}>
                      <tr
                        onClick={() => setExpandedUser(isOpen ? null : u.id)}
                        className={`cursor-pointer transition-colors ${
                          isOpen ? "bg-[#C9A44C]/[0.04]" : "hover:bg-white/[0.03]"
                        }`}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#C9A44C]/20 flex items-center justify-center text-[12px] font-bold text-[#C9A44C]">
                              {u.firstName?.[0] || u.email?.[0]?.toUpperCase() || "?"}
                            </div>
                            <div>
                              <p className="text-[13px] font-medium text-white">
                                {u.firstName} {u.lastName}
                              </p>
                              <p className="text-[11px] text-white/55">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold uppercase tracking-wider ${meta.pillClass}`}
                            >
                              <meta.Icon className="w-3 h-3" />
                              {meta.label}
                            </span>
                            {u.isAList && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold uppercase tracking-wider bg-yellow-500/15 text-yellow-400">
                                <Crown className="w-3 h-3" />
                                Done For You
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#C9A44C] rounded-full"
                                style={{ width: `${u.progressPercent || 0}%` }}
                              />
                            </div>
                            <span className="text-[12px] text-white/65">
                              {u.completedLessons || 0}/{u.totalLessons || 0}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-[12px] text-white/65">
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-"}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="inline-flex items-center gap-2">
                            {canImpersonate && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startImpersonation(u);
                                }}
                                title="View the portal as this user (read-only)"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-bold uppercase tracking-wider border-[#C9A44C]/40 text-[#C9A44C] hover:bg-[#C9A44C]/10 transition-colors"
                              >
                                <Eye className="w-3 h-3" />
                                View as
                              </button>
                            )}
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-bold uppercase tracking-wider transition-colors ${
                                isOpen
                                  ? "border-[#C9A44C] text-[#C9A44C] bg-[#C9A44C]/10"
                                  : "border-white/[0.12] text-white/70"
                              }`}
                            >
                              {isOpen ? "Close" : "Manage"}
                              <ChevronDown
                                className={`w-3.5 h-3.5 transition-transform ${
                                  isOpen ? "rotate-180" : ""
                                }`}
                              />
                            </span>
                          </div>
                        </td>
                      </tr>
                      {isOpen && expandedUserData && (
                        <tr className="bg-white/[0.02]">
                          <td colSpan={5} className="p-0">
                            <div className="px-6 py-5 border-t border-white/[0.06] space-y-5">
                              <UserProfileCard
                                userId={expandedUser!}
                                summary={expandedUserData}
                                isSuperAdmin={isSuperAdmin}
                                isCurrentUser={(me?.user as any)?.id === expandedUser}
                                onDeleted={() => setExpandedUser(null)}
                              />

                              <UserAccessPanel userId={expandedUser!} />

                              <InfluencerBonusPanel userId={expandedUser!} />

                              <div className="flex flex-wrap items-center gap-4">
                    {isAdmin && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] text-white/65">Role:</span>
                      {(["student", "team", "admin"] as const).map((role) => {
                        const isActive = (expandedUserData?.role || "student") === role;
                        const isLocked = role === "admin" && !isSuperAdmin && !isActive;
                        return (
                          <button
                            key={role}
                            onClick={() => {
                              if (isLocked) return;
                              roleMutation.mutate({ userId: expandedUser!, role });
                            }}
                            disabled={roleMutation.isPending || isLocked}
                            title={
                              isLocked
                                ? "Only the portal owner can grant the Admin role."
                                : undefined
                            }
                            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded border transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 ${
                              isActive
                                ? "border-[#C9A44C] bg-[#C9A44C]/10 text-[#C9A44C]"
                                : isLocked
                                ? "border-white/[0.05] text-white/30 cursor-not-allowed"
                                : "border-white/[0.1] text-white/60 hover:text-white hover:border-white/30"
                            }`}
                          >
                            {isLocked && <Lock className="w-3 h-3" />}
                            {ROLE_META[role].label}
                          </button>
                        );
                      })}
                    </div>
                    )}
                    <div className="flex items-center gap-3">
                      <span className="text-[12px] text-white/65">Done For You:</span>
                      <button
                        onClick={() =>
                          aListMutation.mutate({
                            userId: expandedUser!,
                            isAList: !expandedUserData?.isAList,
                          })
                        }
                        disabled={aListMutation.isPending}
                        className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded border transition-colors disabled:opacity-50 flex items-center gap-1.5 ${
                          expandedUserData?.isAList
                            ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                            : "border-white/[0.1] text-white/60 hover:text-yellow-400 hover:border-yellow-500/30"
                        }`}
                      >
                        <Crown className="w-3 h-3" />
                        {expandedUserData?.isAList ? "Remove Done For You" : "Make Done For You"}
                      </button>
                    </div>
                  </div>

                              {isAdmin && expandedUserData?.role === "team" && (
                                <TeamPermissionsEditor
                                  userId={expandedUser!}
                                  teamRole={expandedUserData?.teamRole}
                                  permissions={expandedUserData?.permissions}
                                />
                              )}

                              <UserBillingPanel userId={expandedUser!} />

                              <UserActivityPanel userId={expandedUser!} />

                              {expandedUserData?.isAList && (
                                <AdminDfyPanel
                                  userId={expandedUser!}
                                  userName={
                                    [expandedUserData?.firstName, expandedUserData?.lastName]
                                      .filter(Boolean)
                                      .join(" ") || expandedUserData?.email || `User #${expandedUser}`
                                  }
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

// Per-user upgrades panel. Lists every order bump and upsell with a
// toggle so an admin can grant or revoke access without touching Stripe.
// Grants are stored in a synthetic order row on the server so they
// never overwrite a real purchase.
function UserAccessPanel({ userId }: { userId: number }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-user-access", userId],
    queryFn: () => api.admin.getUserAccess(userId),
  });

  const accessMutation = useMutation({
    mutationFn: (patch: Record<string, boolean>) => api.admin.updateUserAccess(userId, patch),
    onSuccess: (fresh) => {
      queryClient.setQueryData(["admin-user-access", userId], fresh);
    },
  });

  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/30 p-4">
      <p className="text-[11px] uppercase tracking-wider text-[#C9A44C] font-bold mb-3">
        Access &amp; Upgrades
      </p>
      <p className="text-[11px] text-white/50 mb-4 leading-relaxed">
        Toggle each item on to grant access (e.g. they bought an order bump but did not auto-sync,
        or you want to comp them). Toggling off only removes a manual grant. Real Stripe purchases
        cannot be revoked from here.
      </p>
      {isLoading || !data ? (
        <div className="py-6 flex justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-white/40" />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          {ACCESS_FLAGS.map((f) => {
            const on = !!(data as any)[f.key] || (f.linkedKey ? !!(data as any)[f.linkedKey] : false);
            const pending = accessMutation.isPending && (
              (accessMutation.variables as any)?.[f.key] !== undefined ||
              (f.linkedKey && (accessMutation.variables as any)?.[f.linkedKey] !== undefined)
            );
            return (
              <button
                key={f.key}
                onClick={() => {
                  const patch: Record<string, boolean> = { [f.key]: !on };
                  if (f.linkedKey) patch[f.linkedKey] = !on;
                  accessMutation.mutate(patch);
                }}
                disabled={accessMutation.isPending}
                className={`text-left px-3 py-2.5 rounded-lg border transition-colors flex items-start gap-3 disabled:opacity-50 ${
                  on
                    ? "border-green-500/25 bg-green-500/5 hover:bg-green-500/10"
                    : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
                }`}
              >
                <div
                  className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${
                    on ? "bg-green-500/80 text-black" : "bg-white/[0.06] text-white/30"
                  }`}
                >
                  {pending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : on ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-white leading-tight">{f.label}</p>
                  <p className="text-[10.5px] text-white/45 mt-0.5 leading-snug">{f.sub}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Bonus AI Influencer generations panel. Lets an admin grant or take
// back arbitrary-N bonus builds on top of the base entitlement
// (1 free + 5 from Upsell 2). Writes portal_users.bonus_influencer_quota
// via PATCH /portal/admin/users/:userId/influencer-bonus. Use "Add" for
// a delta (negative allowed) or "Set to" for an absolute value.
function InfluencerBonusPanel({ userId }: { userId: number }) {
  const queryClient = useQueryClient();
  const { data: access } = useQuery({
    queryKey: ["admin-user-access", userId],
    queryFn: () => api.admin.getUserAccess(userId),
  });
  const current = Number((access as any)?.bonusInfluencerQuota ?? 0);
  const upsell2On = !!(access as any)?.upsell2Paid;
  const baseFromUpsell = upsell2On ? 5 : 0;
  const totalCap = 1 + baseFromUpsell + Math.max(0, current);

  const [addValue, setAddValue] = useState<string>("1");
  const [setValue, setSetValue] = useState<string>("");
  const [flash, setFlash] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (patch: { add?: number; set?: number }) =>
      api.admin.updateInfluencerBonus(userId, patch),
    onSuccess: (res) => {
      setFlash(
        `Updated bonus: ${res.previous} -> ${res.bonusInfluencerQuota} (delta ${
          res.delta >= 0 ? "+" : ""
        }${res.delta}).`,
      );
      setSetValue(String(res.bonusInfluencerQuota));
      queryClient.invalidateQueries({ queryKey: ["admin-user-access", userId] });
    },
    onError: (err: any) => {
      setFlash(`Failed: ${err?.message || "unknown error"}`);
    },
  });

  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/30 p-4">
      <p className="text-[11px] uppercase tracking-wider text-[#C9A44C] font-bold mb-3">
        Bonus AI Influencer Generations
      </p>
      <p className="text-[11px] text-white/50 mb-4 leading-relaxed">
        Grant any number of extra AI Influencer builds on top of the base
        entitlement (1 free, plus 5 more if Upsell 2 is on). Use Add to
        bump by a delta (negative allowed) or Set to overwrite to an exact
        value. Never goes below 0.
      </p>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="text-[12px] text-white/70">
          <span className="block text-white/45 text-[10.5px] uppercase tracking-wider mb-1">
            Current bonus
          </span>
          <span className="font-bold text-white text-[15px]">{current}</span>
          <span className="text-white/45 ml-2">
            (total cap for this user: <span className="text-[#C9A44C] font-bold">{totalCap}</span>)
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-end gap-2">
          <label className="flex flex-col text-[10.5px] uppercase tracking-wider text-white/45">
            Add (delta)
            <input
              type="number"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              className="mt-1 w-24 px-2 py-1.5 rounded bg-black/40 border border-white/[0.08] text-white text-[12px]"
            />
          </label>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => {
              const n = parseInt(addValue, 10);
              if (Number.isNaN(n)) return;
              setFlash(null);
              mutation.mutate({ add: n });
            }}
            className="px-3 py-1.5 rounded bg-[#C9A44C] text-black text-[12px] font-bold disabled:opacity-50"
          >
            Apply add
          </button>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col text-[10.5px] uppercase tracking-wider text-white/45">
            Or set to
            <input
              type="number"
              min={0}
              value={setValue}
              onChange={(e) => setSetValue(e.target.value)}
              placeholder={String(current)}
              className="mt-1 w-24 px-2 py-1.5 rounded bg-black/40 border border-white/[0.08] text-white text-[12px]"
            />
          </label>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => {
              const n = parseInt(setValue, 10);
              if (Number.isNaN(n) || n < 0) return;
              setFlash(null);
              mutation.mutate({ set: n });
            }}
            className="px-3 py-1.5 rounded bg-emerald-500 text-black text-[12px] font-bold disabled:opacity-50"
          >
            Apply set
          </button>
        </div>
      </div>
      {mutation.isPending && (
        <p className="mt-3 text-[11px] text-white/40 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Saving...
        </p>
      )}
      {flash && !mutation.isPending && (
        <p className="mt-3 text-[11px] text-white/70">{flash}</p>
      )}
    </div>
  );
}

// Per-team-member capability editor. Shown in the expanded row for any
// user whose role is "team". Lets an admin pick a preset and/or toggle
// individual capabilities, then PATCHes them via setTeamPermissions.
// The backend remains the security boundary; this only drives the grant.
function TeamPermissionsEditor({
  userId,
  teamRole,
  permissions,
}: {
  userId: number;
  teamRole?: string | null;
  permissions?: unknown;
}) {
  const queryClient = useQueryClient();
  const initialCaps = sanitizeCapabilities(permissions);
  const initialRole: TeamRoleKey = isTeamRoleKey(teamRole) ? teamRole : "custom";

  const [roleKey, setRoleKey] = useState<TeamRoleKey>(initialRole);
  const [caps, setCaps] = useState<TeamCapability[]>(initialCaps);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);

  // Re-seed when a different user row is expanded into this same component.
  useEffect(() => {
    setRoleKey(isTeamRoleKey(teamRole) ? teamRole : "custom");
    setCaps(sanitizeCapabilities(permissions));
    setFlash(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const mutation = useMutation({
    mutationFn: () =>
      api.admin.setTeamPermissions(userId, { teamRole: roleKey, permissions: caps }),
    onSuccess: () => {
      setFlash({ ok: true, msg: "Permissions saved." });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: any) => {
      setFlash({ ok: false, msg: err?.message || "Could not save permissions." });
    },
  });

  function applyPreset(preset: TeamRoleKey) {
    setRoleKey(preset);
    if (preset !== "custom") setCaps([...TEAM_ROLE_PRESETS[preset].capabilities]);
  }

  function toggleCap(cap: TeamCapability) {
    setRoleKey("custom");
    setCaps((c) => (c.includes(cap) ? c.filter((x) => x !== cap) : [...c, cap]));
  }

  const dirty =
    roleKey !== initialRole ||
    caps.length !== initialCaps.length ||
    caps.some((c) => !initialCaps.includes(c));

  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.04] p-4 space-y-4">
      <p className="text-[11px] uppercase tracking-wider text-blue-200 font-bold">
        Team permissions
      </p>
      <div>
        <label className="block text-[11px] text-white/55 mb-1.5">Role preset</label>
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(TEAM_ROLE_PRESETS) as TeamRoleKey[]).map((key) => {
            const isActive = roleKey === key;
            return (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                title={TEAM_ROLE_PRESETS[key].description}
                className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded border transition-colors ${
                  isActive
                    ? "border-blue-400 bg-blue-500/15 text-blue-200"
                    : "border-white/[0.1] text-white/60 hover:text-white hover:border-white/30"
                }`}
              >
                {TEAM_ROLE_PRESETS[key].label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-white/45 mt-2">
          {TEAM_ROLE_PRESETS[roleKey].description}
        </p>
      </div>
      <div>
        <label className="block text-[11px] text-white/55 mb-2">Permissions</label>
        <div className="grid sm:grid-cols-2 gap-2">
          {TEAM_CAPABILITIES.map((cap) => (
            <label
              key={cap}
              className="flex items-start gap-3 p-3 rounded-lg border border-white/[0.08] bg-black/30 cursor-pointer hover:border-blue-400/40 transition-colors"
            >
              <input
                type="checkbox"
                checked={caps.includes(cap)}
                onChange={() => toggleCap(cap)}
                className="mt-0.5 w-4 h-4 accent-blue-400 cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-white">{CAPABILITY_META[cap].label}</p>
                <p className="text-[11px] text-white/45 mt-0.5">
                  {CAPABILITY_META[cap].description}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !dirty}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 text-white text-[11px] font-bold uppercase tracking-wider hover:bg-blue-400 transition-colors disabled:opacity-50"
        >
          {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save permissions
        </button>
        {flash && (
          <span className={`text-[12px] ${flash.ok ? "text-green-300" : "text-red-300"}`}>
            {flash.msg}
          </span>
        )}
      </div>
    </div>
  );
}

// Identity card. Shows name + email + Clerk metadata, with inline edit
// for first name, last name and email, plus the destructive actions
// (reset password, delete user). The summary prop is the row data we
// already have from the users list, used as a fallback while the full
// profile request is in flight so the card never flashes empty.
function UserProfileCard({
  userId,
  summary,
  isSuperAdmin,
  isCurrentUser,
  onDeleted,
}: {
  userId: number;
  summary: any;
  isSuperAdmin: boolean;
  isCurrentUser: boolean;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-user-profile", userId],
    queryFn: () => api.admin.getUserProfile(userId),
  });

  const profile: any = data?.user || summary || {};
  const clerk: any = data?.clerkProfile || null;
  const lockedDelete = (profile.role === "admin" && !isSuperAdmin) || isCurrentUser;

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState<string>("");
  const [lastName, setLastName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [editError, setEditError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  function startEditing() {
    setFirstName(profile.firstName || "");
    setLastName(profile.lastName || "");
    setEmail(profile.email || "");
    setEditError(null);
    setEditing(true);
  }

  const editMutation = useMutation({
    mutationFn: (patch: { firstName?: string; lastName?: string; email?: string }) =>
      api.admin.updateUserProfile(userId, patch),
    onSuccess: () => {
      setEditing(false);
      setEditError(null);
      setFeedback({ ok: true, msg: "Profile updated." });
      queryClient.invalidateQueries({ queryKey: ["admin-user-profile", userId] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: any) => {
      setEditError(err?.message || "Could not update profile.");
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => api.admin.resetUserPassword(userId),
    onSuccess: (r: any) => {
      setFeedback({
        ok: true,
        msg: `Password reset email sent to ${r?.emailedTo || profile.email}.`,
      });
    },
    onError: (err: any) => {
      setFeedback({ ok: false, msg: err?.message || "Could not reset password." });
    },
  });

  const resendMutation = useMutation({
    mutationFn: () => api.admin.resendInvite(userId),
    onSuccess: (r: any) => {
      setFeedback({
        ok: true,
        msg: r?.alreadyHadAccount
          ? `Re-sent the "training unlocked" email to ${r?.emailedTo || profile.email}.`
          : `Invite re-sent to ${r?.emailedTo || profile.email}.`,
      });
    },
    onError: (err: any) => {
      setFeedback({ ok: false, msg: err?.message || "Could not resend invite." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.admin.deleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      onDeleted();
    },
    onError: (err: any) => {
      setFeedback({ ok: false, msg: err?.message || "Could not delete user." });
      setConfirmDelete(false);
    },
  });

  function submitEdit() {
    setEditError(null);
    const patch: { firstName?: string; lastName?: string; email?: string } = {};
    if ((firstName || "") !== (profile.firstName || "")) patch.firstName = firstName.trim();
    if ((lastName || "") !== (profile.lastName || "")) patch.lastName = lastName.trim();
    const cleanEmail = email.trim().toLowerCase();
    const currentEmail = (profile.email || "").toLowerCase();
    if (cleanEmail !== currentEmail) {
      if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
        setEditError("Enter a valid email.");
        return;
      }
      patch.email = cleanEmail;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    editMutation.mutate(patch);
  }

  const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "(no name set)";
  const lastSignIn = clerk?.lastSignInAt
    ? new Date(clerk.lastSignInAt).toLocaleString()
    : profile.lastLoginAt
    ? new Date(profile.lastLoginAt).toLocaleString()
    : "Never";

  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/30 p-4 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-[#C9A44C] font-bold mb-2">
            Profile
          </p>
          {editing ? (
            <div className="space-y-3 max-w-[520px]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-white/55 mb-1.5">First name</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/[0.1] text-white text-[13px] focus:outline-none focus:border-[#C9A44C]/60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-white/55 mb-1.5">Last name</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/[0.1] text-white text-[13px] focus:outline-none focus:border-[#C9A44C]/60"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-white/55 mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 rounded-lg bg-black/50 border border-white/[0.1] text-white text-[13px] focus:outline-none focus:border-[#C9A44C]/60"
                  />
                </div>
                <p className="text-[10.5px] text-white/40 mt-1.5">
                  Changing the email moves their orders, invites, email logs and access logs to the
                  new address. The user signs in with the new email immediately.
                </p>
              </div>
              {editError && (
                <p className="text-[12px] text-red-300">{editError}</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={submitEdit}
                  disabled={editMutation.isPending}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#C9A44C] text-black text-[11px] font-bold uppercase tracking-wider hover:bg-[#d4b25a] transition-colors disabled:opacity-50"
                >
                  {editMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setEditError(null);
                  }}
                  className="px-3 py-2 rounded-lg border border-white/[0.12] text-white/60 text-[11px] font-bold uppercase tracking-wider hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[18px] font-bold text-white leading-tight">{displayName}</p>
              <p className="text-[12.5px] text-white/65 mt-0.5">{profile.email}</p>
              {!profile.clerkId && (
                <div
                  className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-yellow-500/40 bg-yellow-500/10 text-[10.5px] font-bold uppercase tracking-wider text-yellow-300"
                  title="This user has access flags but no login account, so they can't sign in yet. Ask them to use 'Create an account' with this exact email - their access transfers automatically."
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  No login yet - can't sign in
                </div>
              )}
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-[11px] text-white/45">
                <span>
                  Joined{" "}
                  <span className="text-white/65">
                    {profile.createdAt ? new Date(profile.createdAt).toLocaleDateString() : "-"}
                  </span>
                </span>
                <span>
                  Last sign-in <span className="text-white/65">{lastSignIn}</span>
                </span>
                {clerk?.emailVerified !== undefined && (
                  <span>
                    Email{" "}
                    <span className={clerk.emailVerified ? "text-green-300" : "text-yellow-300"}>
                      {clerk.emailVerified ? "verified" : "unverified"}
                    </span>
                  </span>
                )}
                {profile.clerkId && (
                  <span className="text-white/35">Clerk ID: {profile.clerkId}</span>
                )}
              </div>
            </>
          )}
        </div>

        {!editing && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={startEditing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/[0.12] text-white/70 text-[11px] font-bold uppercase tracking-wider hover:border-white/30 hover:text-white"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
            <button
              onClick={() => resendMutation.mutate()}
              disabled={resendMutation.isPending || !profile.email}
              title="Re-send the welcome / invite email so they can set up or recover their login."
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/[0.12] text-white/70 text-[11px] font-bold uppercase tracking-wider hover:border-white/30 hover:text-white disabled:opacity-50"
            >
              {resendMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Mail className="w-3.5 h-3.5" />
              )}
              Resend Invite
            </button>
            <button
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending || !profile.email}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-purple-500/40 text-purple-300 text-[11px] font-bold uppercase tracking-wider hover:bg-purple-500/10 disabled:opacity-50"
            >
              {resetMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <KeyRound className="w-3.5 h-3.5" />
              )}
              Reset Password
            </button>
            <button
              onClick={() => {
                if (lockedDelete) return;
                setConfirmDelete(true);
                setDeleteText("");
              }}
              disabled={lockedDelete}
              title={
                isCurrentUser
                  ? "You cannot delete your own account."
                  : profile.role === "admin" && !isSuperAdmin
                  ? "Only the portal owner can delete an Admin."
                  : undefined
              }
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[11px] font-bold uppercase tracking-wider ${
                lockedDelete
                  ? "border-white/[0.05] text-white/25 cursor-not-allowed"
                  : "border-red-500/40 text-red-300 hover:bg-red-500/10"
              }`}
            >
              {lockedDelete && <Lock className="w-3 h-3" />}
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        )}
      </div>

      {feedback && (
        <p
          className={`text-[12px] ${
            feedback.ok ? "text-green-300" : "text-red-300"
          }`}
        >
          {feedback.msg}
        </p>
      )}

      {isLoading && !data && (
        <p className="text-[11px] text-white/40">Loading profile...</p>
      )}

      {confirmDelete && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/[0.06] p-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-300 mt-0.5 flex-shrink-0" />
            <div className="space-y-1.5">
              <p className="text-[13px] font-bold text-red-200 uppercase tracking-wider">
                Delete this user permanently?
              </p>
              <p className="text-[12px] text-white/70 leading-relaxed">
                This wipes their sign-in account, their lesson progress, their activity log,
                pending invites, manual access grants, and every per-user record in the marketing
                tool. Real Stripe order rows are kept for audit. This cannot be undone.
              </p>
              <p className="text-[11px] text-white/55">
                Type <span className="font-mono text-red-200">{profile.email}</span> below to
                confirm.
              </p>
            </div>
          </div>
          <input
            type="text"
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            placeholder={profile.email || ""}
            className="w-full px-3 py-2 rounded-lg bg-black/50 border border-red-500/30 text-white text-[12px] font-mono focus:outline-none focus:border-red-400/60"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={
                deleteMutation.isPending ||
                deleteText.trim().toLowerCase() !== (profile.email || "").toLowerCase()
              }
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500 text-white text-[11px] font-bold uppercase tracking-wider hover:bg-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Delete forever
            </button>
            <button
              onClick={() => {
                setConfirmDelete(false);
                setDeleteText("");
              }}
              className="px-3 py-2 rounded-lg border border-white/[0.12] text-white/60 text-[11px] font-bold uppercase tracking-wider hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Billing card. Shows every order row keyed off the user's email so the
// admin can audit upgrades, comp grants and Stripe receipts at a glance.
function UserBillingPanel({ userId }: { userId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-user-profile", userId],
    queryFn: () => api.admin.getUserProfile(userId),
  });
  const orders: any[] = (data as any)?.orders || [];
  const influencerBuilds: any = (data as any)?.influencerBuilds || null;

  function formatAmount(v: any): string {
    if (v === null || v === undefined || v === "") return "-";
    const n = typeof v === "number" ? v : parseFloat(v);
    if (Number.isNaN(n)) return String(v);
    return `$${n.toFixed(2)}`;
  }

  function productSummary(o: any): string {
    const labels: string[] = [];
    if (o.mainProductPaid) labels.push("Main");
    if (o.bump1Paid) labels.push("Bump 1");
    if (o.bump2Paid) labels.push("Bump 2");
    if (o.bump3Paid) labels.push("Bump 3");
    if (o.upsell1Paid) labels.push("Upsell 1");
    if (o.upsell2Paid) labels.push("Upsell 2");
    if (o.upsell3Paid) labels.push("Upsell 3");
    if (o.downsell1Paid) labels.push("Downsell 1");
    if (o.tiktokSlideshowPaid) labels.push("TikTok AI Slideshow");
    if (o.hookDemoPaid) labels.push("Hook + Demo");
    if (o.doneForYouPackPaid) labels.push("DFY Pack");
    if (o.portfolioPaid) labels.push("Portfolio");
    if (o.platinumPaid) labels.push("Platinum");
    return labels.length > 0 ? labels.join(", ") : "Empty";
  }

  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/30 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Receipt className="w-3.5 h-3.5 text-[#C9A44C]" />
        <p className="text-[11px] uppercase tracking-wider text-[#C9A44C] font-bold">
          Billing history
        </p>
        <span className="text-[11px] text-white/45">({orders.length})</span>
      </div>
      {influencerBuilds ? (
        <div className="rounded border border-white/[0.06] bg-white/[0.02] px-3 py-2 mb-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11.5px] text-white/75">
            AR Influencer builds:{" "}
            <span className="text-white font-semibold">
              {influencerBuilds.used} of {influencerBuilds.total}
            </span>
          </div>
          <div className="text-[10.5px] uppercase tracking-wider">
            {influencerBuilds.bonusUnlocked ? (
              <span className="text-[#C9A44C] font-bold">
                Bonus pack unlocked - {influencerBuilds.bonusUsed} of {influencerBuilds.total - 1} used
                {influencerBuilds.unlockSeen ? "" : " - popup pending"}
              </span>
            ) : (
              <span className="text-white/45">Bonus pack locked</span>
            )}
          </div>
        </div>
      ) : null}
      {isLoading && !data ? (
        <div className="py-4 flex justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-white/40" />
        </div>
      ) : orders.length === 0 ? (
        <p className="text-[12px] text-white/45">No orders yet.</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left px-2 py-2 text-[10.5px] text-white/55 uppercase tracking-wider font-bold">
                  Date
                </th>
                <th className="text-left px-2 py-2 text-[10.5px] text-white/55 uppercase tracking-wider font-bold">
                  Type
                </th>
                <th className="text-left px-2 py-2 text-[10.5px] text-white/55 uppercase tracking-wider font-bold">
                  Products
                </th>
                <th className="text-right px-2 py-2 text-[10.5px] text-white/55 uppercase tracking-wider font-bold">
                  Total
                </th>
                <th className="text-left px-2 py-2 text-[10.5px] text-white/55 uppercase tracking-wider font-bold">
                  Receipt
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-2 py-2 text-[11.5px] text-white/65 whitespace-nowrap">
                    {o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "-"}
                  </td>
                  <td className="px-2 py-2">
                    {o.isAdminGrant ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-500/15 text-purple-300">
                        Comp
                      </span>
                    ) : o.mainProductPaid ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-green-500/15 text-green-300">
                        Paid
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white/[0.06] text-white/55">
                        {o.currentStep || "Cart"}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-[11.5px] text-white/75">
                    {productSummary(o)}
                  </td>
                  <td className="px-2 py-2 text-[11.5px] text-white/85 text-right whitespace-nowrap">
                    {formatAmount(o.totalAmount)}
                  </td>
                  <td className="px-2 py-2 text-[10.5px] text-white/45 font-mono truncate max-w-[160px]">
                    {o.stripeSessionId || o.whopReceiptId || (o.isAdminGrant ? "admin grant" : "-")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Activity card. Shows the most recent access log entries so the admin
// can verify the user is actually moving through the portal.
function UserActivityPanel({ userId }: { userId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-user-profile", userId],
    queryFn: () => api.admin.getUserProfile(userId),
  });
  const activity: any[] = (data as any)?.activity || [];

  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/30 p-4">
      <div className="flex items-center gap-2 mb-3">
        <ActivityIcon className="w-3.5 h-3.5 text-[#C9A44C]" />
        <p className="text-[11px] uppercase tracking-wider text-[#C9A44C] font-bold">
          Recent activity
        </p>
        <span className="text-[11px] text-white/45">({activity.length})</span>
      </div>
      {isLoading && !data ? (
        <div className="py-4 flex justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-white/40" />
        </div>
      ) : activity.length === 0 ? (
        <p className="text-[12px] text-white/45">No activity recorded yet.</p>
      ) : (
        <ul className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
          {activity.map((a, i) => (
            <li
              key={a.id ?? i}
              className="flex items-center justify-between gap-3 text-[11.5px] text-white/70 py-1 border-b border-white/[0.03]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <span className="text-white/55">{a.action || "view"}</span>
                  {" "}
                  <span className="text-white/85">{a.resourceId || a.resourcePath || ""}</span>
                </p>
              </div>
              <span className="text-[10.5px] text-white/40 whitespace-nowrap">
                {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Task #710 — Global searchable "View as user…" picker.
// Opened from the page header; filters the same admin users list in-place
// and lets a super-admin start an impersonation session against any row.
// ─────────────────────────────────────────────────────────────────────────────
interface PickerUser {
  id: number;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  clerkId?: string | null;
}
function ViewAsPicker({
  users,
  onClose,
  onPick,
}: {
  users: PickerUser[];
  onClose: () => void;
  onPick: (u: PickerUser) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users.slice(0, 50);
    return users
      .filter((u) => {
        const e = (u.email || "").toLowerCase();
        const f = (u.firstName || "").toLowerCase();
        const l = (u.lastName || "").toLowerCase();
        return e.includes(needle) || f.includes(needle) || l.includes(needle);
      })
      .slice(0, 50);
  }, [users, q]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-20 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-[#0f0f0f] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="p-4 border-b border-white/[0.06] flex items-center gap-3">
          <Eye className="w-4 h-4 text-[#C9A44C]" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by email or name…"
            className="flex-1 bg-transparent text-white text-[14px] placeholder:text-white/40 focus:outline-none"
          />
          <button
            onClick={onClose}
            className="text-white/45 hover:text-white text-[11px] uppercase tracking-wider"
          >
            Esc
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-6 text-center text-[12px] text-white/45">
              No users match "{q}"
            </p>
          ) : (
            <ul>
              {filtered.map((u) => {
                const name =
                  [u.firstName, u.lastName].filter(Boolean).join(" ") || "—";
                return (
                  <li key={u.id}>
                    <button
                      onClick={() => onPick(u)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/[0.04] text-left border-b border-white/[0.03] last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] text-white truncate flex items-center gap-1.5">
                          {name}
                          {!u.clerkId && (
                            <span
                              title="No login yet - can't sign in"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-yellow-500/40 bg-yellow-500/10 text-[9px] font-bold uppercase tracking-wider text-yellow-300"
                            >
                              <AlertTriangle className="w-2.5 h-2.5" />
                              No login
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-white/55 truncate">
                          {u.email || `#${u.id}`}
                        </p>
                      </div>
                      <span className="text-[10px] uppercase tracking-wider text-[#C9A44C]/80">
                        View as →
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
