import type { CSSProperties } from "react";

type Room30LogoProps = {
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
};

// "AI INFLUENCERS / PORTFOLIO" image wordmark (client-supplied PNG in
// public/). Sized off the caller's font size — every existing caller's
// `text-[NNpx]` (or inline `style.fontSize`) keeps driving the visual size
// with no further changes: the image height is a fixed multiple of 1em, so
// bigger text classes produce a proportionally bigger logo.
const LOGO_SRC = `${import.meta.env.BASE_URL}ai-influencers-portfolio-logo.png`;

export function Room30Logo({
  className = "",
  style,
  ariaLabel = "AI Influencers Portfolio",
}: Room30LogoProps) {
  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className={`inline-block select-none align-middle leading-none ${className}`}
      style={style}
    >
      <img
        src={LOGO_SRC}
        alt=""
        draggable={false}
        className="block w-auto"
        style={{ height: "1.35em" }}
      />
    </span>
  );
}
