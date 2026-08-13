import { useLocation } from "wouter";
import { Lock } from "lucide-react";

// Headline copy that changes based on the Clerk sub-step URL segment
const SIGN_IN_COPY: Record<string, { eyebrow: string; title: string; subtitle: string }> = {
  default: {
    eyebrow: "Sign In",
    title: "Open the Portal",
    subtitle: "Use the email address tied to your Room30 account.",
  },
  "factor-one": {
    eyebrow: "Verification",
    title: "Enter Your Code",
    subtitle: "Check your inbox and enter the code we sent you.",
  },
  "factor-two": {
    eyebrow: "Two-Factor Auth",
    title: "One More Step",
    subtitle: "Enter the code from your authenticator app.",
  },
  "reset-password": {
    eyebrow: "Reset Password",
    title: "Set a New Password",
    subtitle: "Choose a strong password for your account.",
  },
  "forgot-password": {
    eyebrow: "Forgot Password",
    title: "Check Your Inbox",
    subtitle: "We sent a reset link to your email. It expires in a few minutes.",
  },
};

const SIGN_UP_COPY: Record<string, { eyebrow: string; title: string; subtitle: string }> = {
  default: {
    eyebrow: "Create Your Account",
    title: "Get Inside the Room",
    subtitle: "Use the email address you bought with so your access matches up.",
  },
  "verify-email-address": {
    eyebrow: "Verify Your Email",
    title: "Check Your Inbox",
    subtitle: "We sent a verification code to your email. Enter it below to continue.",
  },
  continue: {
    eyebrow: "Almost There",
    title: "Finish Setting Up",
    subtitle: "Just a couple more details and you're in.",
  },
};

interface AuthShellProps {
  mode: "sign-in" | "sign-up";
  children: React.ReactNode;
}

export function AuthShell({ mode, children }: AuthShellProps) {
  const [location] = useLocation();

  // Detect the sub-step from the URL path segment after /sign-in or /sign-up
  const subStep = location.split("/").find((seg, i, arr) => {
    const base = mode === "sign-in" ? "sign-in" : "sign-up";
    const baseIdx = arr.indexOf(base);
    return i > baseIdx && seg.length > 0;
  }) ?? "default";

  const copyMap = mode === "sign-in" ? SIGN_IN_COPY : SIGN_UP_COPY;
  const copy = copyMap[subStep] ?? copyMap.default;

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
          <a
            href="/"
            className="text-[22px] font-black tracking-[0.02em] text-white"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            ROOM<span className="text-[#C9A44C]">30</span>.AI
          </a>
        </div>

        {/* Hero copy */}
        <div className="my-auto py-16">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#C9A44C]/70 mb-5">
            {copy.eyebrow}
          </p>
          <h1
            className="text-[clamp(32px,4vw,52px)] font-black uppercase leading-[1.0] text-white mb-6"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            {copy.title.split(" ").slice(0, 3).join(" ")}{" "}
            {copy.title.split(" ").length > 3 && (
              <>
                <br />
                {copy.title.split(" ").slice(3).join(" ")}
              </>
            )}
          </h1>
          <p className="text-[14px] text-white/50 leading-[1.7] max-w-[340px]">
            {copy.subtitle}
          </p>

          {/* Legacy buyer helper — only on sign-in base step */}
          {mode === "sign-in" && subStep === "default" && (
            <LegacyBuyerHelper />
          )}
        </div>

        {/* Footer */}
        <div>
          <div className="flex items-center gap-2 text-[11.5px] text-white/30">
            <Lock className="w-3 h-3" />
            <span>Secure sign-in. Your data stays yours.</span>
          </div>
        </div>

        {/* Decorative gold gradient orb */}
        <div
          className="pointer-events-none absolute bottom-0 left-0 w-[420px] h-[420px] opacity-20"
          style={{
            background: "radial-gradient(circle, #C9A44C 0%, transparent 70%)",
            transform: "translate(-40%, 40%)",
          }}
        />
      </div>

      {/* ── Right panel — Clerk form ───────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center px-6 py-14 bg-[#0d0d0d] border-l border-white/[0.04]">
        <div className="w-full max-w-[440px]">
          {children}

          {/* Switch between sign-in and sign-up */}
          {mode === "sign-in" ? (
            <p className="mt-6 text-center text-[12.5px] text-white/35">
              First time here?{" "}
              <a
                href="/members/sign-up"
                className="text-[#C9A44C] hover:text-[#d8b566] transition-colors underline underline-offset-2"
              >
                Create an account
              </a>
            </p>
          ) : (
            <p className="mt-6 text-center text-[12.5px] text-white/35">
              Already have an account?{" "}
              <a
                href="/members/sign-in"
                className="text-[#C9A44C] hover:text-[#d8b566] transition-colors font-semibold"
              >
                Sign in
              </a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── "Bought but can't sign in?" helper ─────────────────────────────────── */
function LegacyBuyerHelper() {
  return (
    <div className="mt-8 rounded-xl border border-white/[0.06] bg-white/[0.015] p-5 max-w-[340px]">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#C9A44C]/60 mb-1">
        Bought already but can't sign in?
      </p>
      <p className="text-[12px] text-white/35 leading-[1.6] mb-3">
        If you bought through Whop or were added by our team, you may not have
        a login yet. Enter your purchase email to create your account — your
        access transfers automatically.
      </p>
      <PurchaseEmailForm />
    </div>
  );
}

function PurchaseEmailForm() {
  const [email, setEmail] = React.useState("");
  const [, setLocation] = useLocation();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setLocation(`/sign-up?email=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
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
  );
}

import React from "react";
