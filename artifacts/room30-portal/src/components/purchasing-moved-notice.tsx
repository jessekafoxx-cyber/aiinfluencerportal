// Shared purchase CTA shown where the retired on-site checkout widgets used
// to mount. When a purchaseUrl is provided this renders an upgrade button
// that opens the checkout page in a new tab. An optional tagline replaces
// the generic "Upgrade to unlock {label}." sentence with a product-specific
// one-liner pulled from the upsell definition. When no link is configured
// yet, it falls back to the contact prompt.

import { ExternalLink } from "lucide-react";

export function PurchasingMovedNotice(props: {
  /** What the buyer was trying to purchase, e.g. "Our Portfolio". */
  label: string;
  /** Checkout page (Stripe or custom). When set, renders the upgrade CTA. */
  purchaseUrl?: string | null;
  /** Product-specific one-liner shown instead of the generic description. */
  tagline?: string | null;
  onCancel?: () => void;
}) {
  if (props.purchaseUrl) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
        <p className="text-sm text-white/80 leading-[1.55]">
          {props.tagline ?? `Upgrade to unlock ${props.label}.`}
        </p>
        <p className="mt-2 text-xs text-white/45">
          Access unlocks automatically after payment.
        </p>
        <a
          href={props.purchaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-full bg-[#C9A44C] px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-[#0A0A0A] hover:bg-[#D9B45C] transition-colors"
          data-testid="link-upgrade-purchase"
        >
          Get Instant Access <ExternalLink className="w-3.5 h-3.5" />
        </a>
        {props.onCancel ? (
          <div>
            <button
              type="button"
              onClick={props.onCancel}
              className="mt-3 inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/5"
            >
              Close
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
      <p className="text-sm text-white/80">{props.label} purchasing has moved.</p>
      <p className="mt-2 text-xs text-white/55">
        Message us in the support chat and we will get you set up.
      </p>
      {props.onCancel ? (
        <button
          type="button"
          onClick={props.onCancel}
          className="mt-4 inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/5"
        >
          Close
        </button>
      ) : null}
    </div>
  );
}
