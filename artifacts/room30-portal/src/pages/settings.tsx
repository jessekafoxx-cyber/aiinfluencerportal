import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { useUser, useClerk } from "@clerk/react";
import { useEffect, useState } from "react";
import { api, stopImpersonationBeforeSignOut } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import {
  User,
  Mail,
  Lock,
  Shield,
  LogOut,
  CreditCard,
  Sparkles,
  ExternalLink,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";

type CreditsStatus = {
  aiUsageCents: number;
  freeCents: number;
  overLimit: boolean;
  notifiedAt: string | null;
  dismissedAt: string | null;
  paidPacks: {
    research: number;
    osTool: number;
    history: Array<{
      id: string;
      kind: "research" | "os_tool";
      label: string;
      amountCents: number;
      status: string;
      createdAt: string | null;
      grantedAt: string | null;
      receiptUrl: string | null;
    }>;
  };
};

type Tab = "profile" | "security" | "account" | "credits";

function formatDate(d: string | null): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const SECTION_CARD =
  "rounded-xl border border-white/[0.07] bg-[#0f0f0f] p-6 md:p-8";

const FIELD_LABEL =
  "block text-[11px] uppercase tracking-[0.12em] text-white/55 font-semibold mb-2";

const TEXT_INPUT =
  "w-full rounded-lg border border-white/[0.1] bg-[#1a1a1a] px-4 py-3 text-[14px] text-white placeholder-white/30 outline-none focus:border-[#C9A44C] focus:ring-2 focus:ring-[#C9A44C]/20 transition";

const PRIMARY_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-[#7c3aed] via-[#a855f7] to-[#c026d3] px-5 py-3 text-[12px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_8px_24px_rgba(124,58,237,0.32)] hover:opacity-95 transition disabled:opacity-50 disabled:cursor-not-allowed";

const SECONDARY_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.04] px-5 py-3 text-[12px] font-bold uppercase tracking-[0.14em] text-white hover:bg-white/[0.08] transition disabled:opacity-50 disabled:cursor-not-allowed";

const GHOST_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-white/70 hover:text-white hover:bg-white/[0.05] transition";

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-lg px-4 py-3 text-left transition border ${
        active
          ? "bg-[#1a1a1a] border-[#C9A44C]/30 text-white"
          : "border-transparent text-white/65 hover:text-white hover:bg-white/[0.04]"
      }`}
    >
      <Icon
        size={16}
        className={active ? "text-[#C9A44C]" : "text-white/45"}
      />
      <span
        className="text-[12px] uppercase tracking-[0.12em] font-semibold"
        style={{ fontFamily: "var(--app-font-display)" }}
      >
        {label}
      </span>
    </button>
  );
}

function SectionTitle({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-6">
      {eyebrow ? (
        <div className="text-[11px] uppercase tracking-[0.18em] text-[#C9A44C] font-bold mb-2">
          {eyebrow}
        </div>
      ) : null}
      <h2
        className="text-[22px] md:text-[26px] font-bold uppercase tracking-[0.02em] text-white leading-tight"
        style={{ fontFamily: "var(--app-font-display)" }}
      >
        {title}
      </h2>
      {subtitle ? (
        <p className="text-[13px] text-white/60 mt-2 leading-relaxed">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

function ProfileSection() {
  const { user, isLoaded } = useUser();
  const isLoading = !isLoaded;
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [initial, setInitial] = useState({ firstName: "", lastName: "", email: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isLoading || !user) return;
    const fn = user?.firstName || "";
    const ln = user?.lastName || "";
    const em = user?.primaryEmailAddress?.emailAddress || "";
    setFirstName(fn);
    setLastName(ln);
    setEmail(em);
    setInitial({ firstName: fn, lastName: ln, email: em });
  }, [isLoading, user]);

  const dirty =
    firstName !== initial.firstName ||
    lastName !== initial.lastName ||
    email.trim().toLowerCase() !== initial.email.trim().toLowerCase();

  async function onSave() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const updates: any = {};
      if (firstName !== initial.firstName) updates.firstName = firstName;
      if (lastName !== initial.lastName) updates.lastName = lastName;
      if (email.trim().toLowerCase() !== initial.email.trim().toLowerCase()) {
        updates.email = email.trim();
      }
      const res: any = await api.me.updateProfile(updates);
      setInitial({
        firstName: res.firstName || "",
        lastName: res.lastName || "",
        email: res.email || "",
      });
      toast({ title: "Profile saved", description: "Your details were updated." });
    } catch (e: any) {
      toast({
        title: "Could not save",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={SECTION_CARD}>
      <SectionTitle
        eyebrow="Profile"
        title="Your details"
        subtitle="Keep your name and email up to date so receipts and team messages reach you."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div>
          <label className={FIELD_LABEL}>First name</label>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={TEXT_INPUT}
            placeholder="First name"
            autoComplete="given-name"
          />
        </div>
        <div>
          <label className={FIELD_LABEL}>Last name</label>
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={TEXT_INPUT}
            placeholder="Last name"
            autoComplete="family-name"
          />
        </div>
      </div>

      <div className="mb-6">
        <label className={FIELD_LABEL}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={TEXT_INPUT}
          placeholder="you@example.com"
          autoComplete="email"
        />
        <p className="text-[12px] text-white/45 mt-2">
          Changing your email also changes the address you sign in with.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={onSave} disabled={!dirty || saving} className={PRIMARY_BUTTON}>
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Saving
            </>
          ) : (
            <>
              <Check size={14} /> Save changes
            </>
          )}
        </button>
        {!dirty ? (
          <span className="text-[12px] text-white/40 uppercase tracking-[0.1em]">
            All changes saved
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SecuritySection() {
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function onReset() {
    if (working) return;
    if (
      !window.confirm(
        "Send a temporary password to your email? You will be signed out of other sessions.",
      )
    ) {
      return;
    }
    setWorking(true);
    try {
      const res: any = await api.me.resetPassword();
      setDone(res?.emailedTo || "your email");
      toast({
        title: "Password reset",
        description: "Check your email for a temporary password.",
      });
    } catch (e: any) {
      toast({
        title: "Could not reset password",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={SECTION_CARD}>
      <SectionTitle
        eyebrow="Security"
        title="Password"
        subtitle="Reset your password and we will email you a temporary one. You can then choose a permanent password from the sign-in screen."
      />

      <div className="rounded-lg border border-white/[0.06] bg-[#161616] p-5 mb-5">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-[#C9A44C]/10 p-2.5 border border-[#C9A44C]/20">
            <Lock size={18} className="text-[#C9A44C]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-white">
              Reset password
            </div>
            <div className="text-[13px] text-white/55 mt-1">
              Rotates your password and signs you out of other devices for safety.
            </div>
          </div>
        </div>
      </div>

      <button onClick={onReset} disabled={working} className={SECONDARY_BUTTON}>
        {working ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Sending
          </>
        ) : (
          <>
            <Shield size={14} /> Send reset email
          </>
        )}
      </button>

      {done ? (
        <div className="mt-4 flex items-start gap-2 text-[13px] text-emerald-300">
          <Check size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            Sent to <strong className="text-white">{done}</strong>. Check your
            inbox in a moment.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function AccountSection() {
  const { user } = useUser();
  const { signOut } = useClerk();

  const accountId = user?.id || "";
  const createdAt = "";
  const lastSignIn = "";

  async function onSignOut() {
    if (!window.confirm("Sign out of this device?")) return;
    try {
      await stopImpersonationBeforeSignOut();
    } catch {}
    await signOut();
  }

  return (
    <div className={SECTION_CARD}>
      <SectionTitle
        eyebrow="Account"
        title="This device"
        subtitle="Sign out of this browser and review your account identifiers."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <div className="rounded-lg border border-white/[0.06] bg-[#161616] p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-white/50 font-semibold">
            Member since
          </div>
          <div className="text-[15px] font-semibold text-white mt-1.5">
            {createdAt || "Today"}
          </div>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-[#161616] p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-white/50 font-semibold">
            Last sign in
          </div>
          <div className="text-[15px] font-semibold text-white mt-1.5">
            {lastSignIn || "Just now"}
          </div>
        </div>
      </div>

      {accountId ? (
        <div className="rounded-lg border border-white/[0.06] bg-[#161616] p-4 mb-6">
          <div className="text-[11px] uppercase tracking-[0.12em] text-white/50 font-semibold">
            Account ID
          </div>
          <div className="text-[12px] font-mono text-white/65 mt-1.5 break-all">
            {accountId}
          </div>
        </div>
      ) : null}

      <button onClick={onSignOut} className={SECONDARY_BUTTON}>
        <LogOut size={14} /> Sign out
      </button>
    </div>
  );
}

type Pack = {
  id: string;
  credits: number;
  amountCents: number;
  label: string;
  tagline: string;
};

function CreditsSection({
  status,
  onChange,
}: {
  status: CreditsStatus;
  onChange: () => void;
}) {
  const [buying, setBuying] = useState<string | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getOSToolCreditPacks();
        setPacks(res?.packs || []);
      } catch {
        setPacks([]);
      }
    })();
  }, []);

  const usage = status.aiUsageCents || 0;
  const overByCents = Math.max(0, usage - status.freeCents);

  async function buyPack(packId: string) {
    if (buying) return;
    setBuying(packId);
    try {
      // Use the actual runtime path so the redirect preserves the portal base
      // mount (e.g. /portal/settings in production).
      const returnPath = window.location.pathname + window.location.search;
      const res = await api.purchaseOSToolCredits(packId, returnPath);
      if (res?.url) {
        window.location.href = res.url;
        return;
      }
      throw new Error("Could not start checkout");
    } catch (e: any) {
      toast({
        title: "Could not start checkout",
        description: e?.message || "Please try again or contact support.",
        variant: "destructive",
      });
      setBuying(null);
    }
  }

  return (
    <div className={SECTION_CARD}>
      <SectionTitle
        eyebrow="AI credits"
        title="Top up your usage"
        subtitle={
          status.overLimit
            ? "You have used your included AI credits. Top up below to keep generating research, ad copy, and offers."
            : "Purchase additional AI credits to keep generating research, ad copy, and offers."
        }
      />

      {status.overLimit ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-5 mb-6 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-[13px] text-amber-100/90 leading-relaxed">
            You have used {formatAmount(usage)} of AI generation. Your existing
            work stays where it is. Top-ups unlock new generations.
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg border border-white/[0.06] bg-[#161616] p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-white/50 font-semibold">
            Usage to date
          </div>
          <div className="text-[22px] font-bold text-white mt-1.5">
            {formatAmount(usage)}
          </div>
          {overByCents > 0 ? (
            <div className="text-[12px] text-amber-300 mt-1">
              {formatAmount(overByCents)} past included
            </div>
          ) : null}
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-[#161616] p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-white/50 font-semibold">
            Research credits
          </div>
          <div className="text-[22px] font-bold text-emerald-300 mt-1.5">
            {status.paidPacks.research}
          </div>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-[#161616] p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-white/50 font-semibold">
            OS Tool credits
          </div>
          <div className="text-[22px] font-bold text-emerald-300 mt-1.5">
            {status.paidPacks.osTool}
          </div>
        </div>
      </div>

      <div className="text-[12px] uppercase tracking-[0.12em] text-white/50 font-semibold mb-3">
        Choose a top up
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {packs.length === 0 ? (
          <div className="col-span-full text-center text-white/45 text-[13px] py-6">
            Loading packs.
          </div>
        ) : (
          packs.map((p, i) => (
            <PackCard
              key={p.id}
              slug={p.id}
              label={p.label}
              tagline={p.tagline}
              amount={p.amountCents}
              credits={p.credits}
              onBuy={buyPack}
              buying={buying === p.id}
              highlighted={i === 1}
            />
          ))
        )}
      </div>

      {status.paidPacks.history.length > 0 ? (
        <div>
          <div className="text-[12px] uppercase tracking-[0.12em] text-white/50 font-semibold mb-3">
            Purchase history
          </div>
          <div className="rounded-lg border border-white/[0.06] overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-[#161616] text-white/50">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Date</th>
                  <th className="text-left px-4 py-2.5 font-medium">Pack</th>
                  <th className="text-left px-4 py-2.5 font-medium">Amount</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-right px-4 py-2.5 font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {status.paidPacks.history.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-white/[0.06] bg-[#1a1a1a]"
                  >
                    <td className="px-4 py-2.5 text-white/80">
                      {formatDate(p.grantedAt || p.createdAt) || "Today"}
                    </td>
                    <td className="px-4 py-2.5 text-white/80">{p.label}</td>
                    <td className="px-4 py-2.5 text-white/80">
                      {formatAmount(p.amountCents)}
                    </td>
                    <td className="px-4 py-2.5">
                      {p.status === "granted" ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] uppercase tracking-wide text-emerald-300">
                          Granted
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-[11px] uppercase tracking-wide text-white/60">
                          {p.status}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {p.receiptUrl ? (
                        <a
                          href={p.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#C9A44C] hover:underline"
                        >
                          View <ExternalLink size={12} />
                        </a>
                      ) : (
                        <span className="text-white/45">.</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PackCard({
  slug,
  label,
  tagline,
  amount,
  credits,
  onBuy,
  buying,
  highlighted,
}: {
  slug: string;
  label: string;
  tagline: string;
  amount: number;
  credits?: number;
  onBuy: (slug: string) => void;
  buying: boolean;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-5 transition ${
        highlighted
          ? "border-[#C9A44C]/40 bg-gradient-to-br from-[#1a1410] to-[#161616] shadow-[0_0_0_1px_rgba(201,164,76,0.1)_inset]"
          : "border-white/[0.07] bg-[#161616]"
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div
            className="text-[16px] font-bold uppercase tracking-[0.06em] text-white"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            {label}
          </div>
          <div className="text-[12px] text-white/55 mt-0.5">{tagline}</div>
        </div>
        {highlighted ? (
          <span className="inline-flex items-center rounded-full bg-[#C9A44C]/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#C9A44C]">
            <Sparkles size={10} className="mr-1" /> Popular
          </span>
        ) : null}
      </div>
      <div className="text-[28px] font-bold text-white mb-4">
        {formatAmount(amount)}
      </div>
      <button
        onClick={() => onBuy(slug)}
        disabled={buying}
        className={`w-full ${highlighted ? PRIMARY_BUTTON : SECONDARY_BUTTON}`}
      >
        {buying ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Charging
          </>
        ) : (
          <>
            <CreditCard size={14} /> Top up
          </>
        )}
      </button>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<Tab>("profile");
  const [credits, setCredits] = useState<CreditsStatus | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(true);

  // Handle Stripe checkout redirect back from credit purchase. Confirms the
  // session, grants credits, then strips the query param and reloads status.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const sid = url.searchParams.get("os_credit_session_id");
      if (!sid) return;
      setTab("credits");
      api
        .confirmOSToolCredits(sid)
        .then((res: any) => {
          if (res?.granted || res?.alreadyGranted) {
            toast({
              title: "Credits added",
              description: `${res.creditsGranted || 0} credits granted. New balance: ${res.balance ?? "."}.`,
            });
          }
          loadCredits();
        })
        .catch((e: any) => {
          toast({
            title: "Could not confirm purchase",
            description: e?.message || "Please refresh or contact support.",
            variant: "destructive",
          });
        })
        .finally(() => {
          try {
            url.searchParams.delete("os_credit_session_id");
            window.history.replaceState({}, "", url.toString());
          } catch {}
        });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCredits() {
    try {
      const data = (await api.me.creditsStatus()) as CreditsStatus;
      setCredits(data);
    } catch {
      setCredits(null);
    } finally {
      setCreditsLoading(false);
    }
  }

  useEffect(() => {
    loadCredits();
  }, []);

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[#C9A44C] font-bold mb-2">
            Account
          </div>
          <h1
            className="text-[32px] md:text-[42px] font-bold uppercase tracking-[0.01em] text-white leading-[1.05]"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Settings
          </h1>
          <p className="text-[14px] text-white/60 mt-3 max-w-[560px]">
            Manage your profile, sign-in security, and account.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 md:gap-8">
          <aside className="md:sticky md:top-6 md:self-start">
            <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible -mx-1 px-1">
              <TabButton
                active={tab === "profile"}
                onClick={() => setTab("profile")}
                icon={User}
                label="Profile"
              />
              <TabButton
                active={tab === "security"}
                onClick={() => setTab("security")}
                icon={Lock}
                label="Security"
              />
              <TabButton
                active={tab === "account"}
                onClick={() => setTab("account")}
                icon={Mail}
                label="Account"
              />
              <TabButton
                active={tab === "credits"}
                onClick={() => setTab("credits")}
                icon={CreditCard}
                label="Credits"
              />
            </div>
          </aside>

          <div className="min-w-0">
            {tab === "profile" ? <ProfileSection /> : null}
            {tab === "security" ? <SecuritySection /> : null}
            {tab === "account" ? <AccountSection /> : null}
            {tab === "credits" ? (
              creditsLoading ? (
                <div className={SECTION_CARD}>
                  <div className="flex items-center gap-2 text-white/50 text-[13px]">
                    <Loader2 size={14} className="animate-spin" /> Loading credits…
                  </div>
                </div>
              ) : credits ? (
                <CreditsSection status={credits} onChange={loadCredits} />
              ) : (
                <div className={SECTION_CARD}>
                  <div className="text-white/60 text-[14px]">
                    Could not load credits. Please refresh.
                  </div>
                </div>
              )
            ) : null}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
