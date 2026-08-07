// Task #9: buyers now purchase on an external GHL sales page opened in a
// new tab. When they tab back to the portal, the entitlement has usually
// already arrived via the GHL webhook — but the purchase UI (buy modal,
// locked-page CTA, buy-credits panel) can still be sitting open showing
// "Upgrade now". These hooks watch for the entitlement flip while a
// purchase surface is open, close it, and announce the unlock.

import { useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";

/**
 * Watches a boolean "owned" signal while a purchase surface is open.
 * Arms only when the surface opens in a locked state, so a surface that
 * opens already-unlocked (e.g. for admins) never fires. When the signal
 * flips false -> true while armed, shows a "You're unlocked" toast and
 * invokes onUnlocked (close the UI / route to the content).
 */
export function useUnlockCelebration(opts: {
  /** Purchase UI currently open/visible. */
  active: boolean;
  /** Merged entitlement signal for the product being sold. */
  unlocked: boolean;
  /** Product name, e.g. "Our Portfolio". */
  label: string;
  /** Optional toast description override. */
  description?: string;
  onUnlocked?: () => void;
}) {
  const armedRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const { active, unlocked } = opts;
  useEffect(() => {
    if (!active) {
      armedRef.current = false;
      return;
    }
    if (!unlocked) {
      armedRef.current = true;
      return;
    }
    if (armedRef.current) {
      armedRef.current = false;
      const o = optsRef.current;
      toast({
        title: "You're unlocked!",
        description:
          o.description ?? `${o.label} is now unlocked. Enjoy your purchase.`,
      });
      o.onUnlocked?.();
    }
  }, [active, unlocked]);
}

/**
 * Credits variant: captures the balance visible when the purchase surface
 * opens and celebrates when the balance rises above that baseline (the
 * GHL webhook credited the wallet while the buyer was on the sales page).
 * A falling balance (credit spent elsewhere) lowers the baseline so a
 * later top-up still fires.
 */
export function useCreditTopUpCelebration(opts: {
  /** Purchase UI currently open/visible. */
  active: boolean;
  /** Current credit balance; null while unknown/unlimited. */
  balance: number | null;
  /** What the credits buy, e.g. "video credits". */
  label: string;
  onToppedUp?: () => void;
}) {
  const baselineRef = useRef<number | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const { active, balance } = opts;
  useEffect(() => {
    if (!active) {
      baselineRef.current = null;
      return;
    }
    if (balance == null) return;
    if (baselineRef.current == null) {
      baselineRef.current = balance;
      return;
    }
    if (balance > baselineRef.current) {
      baselineRef.current = null;
      const o = optsRef.current;
      toast({
        title: "Credits added!",
        description: `Your ${o.label} just landed. You're ready to go.`,
      });
      o.onToppedUp?.();
    } else if (balance < baselineRef.current) {
      baselineRef.current = balance;
    }
  }, [active, balance]);
}

/**
 * While a purchase surface is open, re-pull the entitlement/balance the
 * moment the buyer tabs back from the external checkout. React Query's
 * focus refetch respects staleTime, and some balances live in local
 * state, so this forces a fresh read on window focus / tab visibility.
 */
export function useRefetchOnRefocus(active: boolean, refetch: () => void) {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const onFocus = () => refetchRef.current();
    const onVisible = () => {
      if (document.visibilityState === "visible") refetchRef.current();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);
}
