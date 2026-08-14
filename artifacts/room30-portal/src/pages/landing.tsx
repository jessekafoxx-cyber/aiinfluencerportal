import { useState } from "react";
import { useLocation } from "wouter";
import { Lock, ArrowRight } from "lucide-react";

export function LandingPage() {
  const [view, setView] = useState<"signin" | "create">("signin");
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#0a0a0a]">
      {/* ── Left panel — branding ─────────────────────────────────────── */}
      <div
        className="relative flex flex-col justify-between md:w-[45%] px-10 py-10 overflow-hidden"
        style={{
          background:
            "radial-gradient(ellipse at 30% 60%, rgba(201,164,76,0.18) 0%, transparent 65%), #0a0a0a",
        }}
      >
        {/* Top row */}
        <div className="flex items-center justify-between">
          <img
            src="/members/ai-influencers-portfolio-logo.png"
            alt="AI Influencer Portfolio"
            draggable={false}
            style={{ height: "36px", width: "auto" }}
          />
          <button
            onClick={() => setLocation("/sign-in")}
            className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40 hover:text-[#C9A44C] transition-colors"
          >
            Members
          </button>
        </div>

        {/* Hero copy */}
        <div className="my-auto py-16">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#C9A44C]/70 mb-5">
            Member Portal
          </p>
          <h1
            className="text-[clamp(36px,5vw,58px)] font-black uppercase leading-[1.0] text-white mb-6"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Build The<br />
            Machine.<br />
            Collect The<br />
            <span
              className="italic"
              style={{
                WebkitTextStroke: "1.5px #C9A44C",
                color: "transparent",
              }}
            >
              Commissions.
            </span>
          </h1>
          <p className="text-[14px] text-white/50 leading-[1.7] max-w-[340px]">
            Everything you need to build and run faceless AI influencer
            accounts — training, done-for-you assets, and the tools to put
            it on autopilot. Sign in to keep going.
          </p>
        </div>

        {/* Footer */}
        <div>
          <div className="flex items-center gap-2 text-[11.5px] text-white/30">
            <Lock className="w-3 h-3" />
            <span>Secure sign-in. Your data stays yours.</span>
          </div>
        </div>

      </div>

      {/* ── Right panel — auth ────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center px-6 py-14 bg-[#0d0d0d] border-l border-white/[0.04]">
        <div className="w-full max-w-[420px]">
          {view === "signin" ? (
            <SignInPanel
              onSignIn={() => setLocation("/sign-in")}
              onSwitch={() => setView("create")}
            />
          ) : (
            <CreatePanel
              onSignUp={() => setLocation("/sign-up")}
              onSwitch={() => setView("signin")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sign In panel ──────────────────────────────────────────────────────── */
function SignInPanel({
  onSignIn,
  onSwitch,
}: {
  onSignIn: () => void;
  onSwitch: () => void;
}) {
  const [purchaseEmail, setPurchaseEmail] = useState("");
  const [, setLocation] = useLocation();

  function handlePurchaseSubmit(e: React.FormEvent) {
    e.preventDefault();
    const email = purchaseEmail.trim();
    if (!email) return;
    setLocation(`/sign-up?email=${encodeURIComponent(email)}`);
  }

  return (
    <>
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#C9A44C]/70 mb-2">
        Sign In
      </p>
      <h2
        className="text-[32px] font-black uppercase text-white mb-2 leading-tight"
        style={{ fontFamily: "var(--app-font-display)" }}
      >
        Access Your Program
      </h2>
      <p className="text-[13.5px] text-white/45 mb-8 leading-[1.6]">
        Use the email address you purchased with.
      </p>

      {/* Form — navigates to /sign-in */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-4 mb-6">
        <AuthField label="Email Address" type="email" placeholder="you@example.com" onClick={onSignIn} />
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/40">
              Password
            </label>
            <button
              onClick={onSignIn}
              className="text-[11px] text-[#C9A44C] hover:text-[#d8b566] transition-colors"
            >
              Forgot password?
            </button>
          </div>
          <input
            type="password"
            placeholder="••••••••••••••"
            readOnly
            onClick={onSignIn}
            className="w-full px-4 py-3 rounded-lg bg-[#161616] border border-white/[0.08] text-white text-[13.5px] placeholder-white/20 focus:outline-none focus:border-[#C9A44C]/40 cursor-pointer"
          />
        </div>
        <button
          onClick={onSignIn}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg text-[13px] font-bold uppercase tracking-[0.12em] transition-colors"
          style={{
            background: "linear-gradient(135deg, #C9A44C 0%, #a07830 100%)",
            color: "#000",
          }}
        >
          Continue <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Legacy access helper */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#C9A44C]/60 mb-1">
          Bought already but can't sign in?
        </p>
        <p className="text-[12px] text-white/35 leading-[1.6] mb-3">
          If you bought through Whop or were added by our team, you may not have
          a login yet. Enter your purchase email to create your account — your
          access transfers across automatically.
        </p>
        <form onSubmit={handlePurchaseSubmit} className="flex gap-2">
          <input
            type="email"
            value={purchaseEmail}
            onChange={(e) => setPurchaseEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 px-3 py-2.5 rounded-lg bg-[#161616] border border-white/[0.08] text-white text-[13px] placeholder-white/25 focus:outline-none focus:border-[#C9A44C]/40"
          />
          <button
            type="submit"
            className="px-4 py-2.5 rounded-lg bg-white/[0.06] hover:bg-[#C9A44C]/15 text-white/70 hover:text-[#C9A44C] text-[11px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap border border-white/[0.06]"
          >
            Create Account
          </button>
        </form>
      </div>

      <p className="mt-5 text-center text-[12.5px] text-white/35">
        First time here?{" "}
        <button
          onClick={onSwitch}
          className="text-[#C9A44C] hover:text-[#d8b566] transition-colors underline underline-offset-2"
        >
          Create an account
        </button>
      </p>
    </>
  );
}

/* ── Create Account panel ───────────────────────────────────────────────── */
function CreatePanel({
  onSignUp,
  onSwitch,
}: {
  onSignUp: () => void;
  onSwitch: () => void;
}) {
  return (
    <>
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#C9A44C]/70 mb-2">
        Create Your Account
      </p>
      <h2
        className="text-[32px] font-black uppercase text-white mb-2 leading-tight"
        style={{ fontFamily: "var(--app-font-display)" }}
      >
        Get Started
      </h2>
      <p className="text-[13.5px] text-white/45 mb-8 leading-[1.6]">
        Use the email address you purchased with so your access links up automatically.
      </p>

      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-4">
        <AuthField label="Email Address" type="email" placeholder="Enter your email address" onClick={onSignUp} />
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">
            Password
          </label>
          <div className="relative">
            <input
              type="password"
              placeholder="Create a password"
              readOnly
              onClick={onSignUp}
              className="w-full px-4 py-3 rounded-lg bg-[#161616] border border-white/[0.08] text-white text-[13.5px] placeholder-white/20 focus:outline-none focus:border-[#C9A44C]/40 cursor-pointer pr-10"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 text-[16px]">
              👁
            </span>
          </div>
        </div>
        <button
          onClick={onSignUp}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg text-[13px] font-bold uppercase tracking-[0.12em] transition-colors"
          style={{
            background: "linear-gradient(135deg, #C9A44C 0%, #a07830 100%)",
            color: "#000",
          }}
        >
          Continue <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="mt-5 text-center text-[12.5px] text-white/35">
        Already have an account?{" "}
        <button
          onClick={onSwitch}
          className="text-[#C9A44C] hover:text-[#d8b566] transition-colors font-semibold"
        >
          Sign in
        </button>
      </p>
    </>
  );
}

/* ── Shared input field ─────────────────────────────────────────────────── */
function AuthField({
  label,
  type,
  placeholder,
  onClick,
}: {
  label: string;
  type: string;
  placeholder: string;
  onClick: () => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        readOnly
        onClick={onClick}
        className="w-full px-4 py-3 rounded-lg bg-[#161616] border border-white/[0.08] text-white text-[13.5px] placeholder-white/20 focus:outline-none focus:border-[#C9A44C]/40 cursor-pointer"
      />
    </div>
  );
}
