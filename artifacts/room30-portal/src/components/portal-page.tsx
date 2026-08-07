import type { ReactNode, HTMLAttributes } from "react";

// Shared portal page container.
//
// Standard for every Room30 Portal page that lives inside <PortalLayout>:
//  - generous max-width so content fills the screen on normal desktop
//    viewports (1440px - 1920px) instead of leaving big empty gutters,
//  - sensible upper bound (~1600px) so paragraph lines don't become
//    unreadably long on ultra-wide monitors,
//  - consistent horizontal + vertical padding across every page.
//
// Inner element max-widths used for legitimate reading-width control on
// body paragraphs, modal dialogs, image lightboxes, the auth shell, the
// slide presentation component, and toasts are intentionally left alone.
//
// Use either the <PortalPage> wrapper component or the PORTAL_PAGE_CLASS
// string directly on an existing wrapper div.
export const PORTAL_PAGE_CLASS =
  "mx-auto w-full max-w-[1600px] px-6 md:px-10 py-8 md:py-10";

type PortalPageProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function PortalPage({ children, className, ...rest }: PortalPageProps) {
  return (
    <div className={`${PORTAL_PAGE_CLASS}${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </div>
  );
}
