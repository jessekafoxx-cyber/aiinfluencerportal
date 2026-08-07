// Single source of truth for the Friday 15th drop lock.
//
// Set PRELAUNCH_LOCKED to false (or empty PRELAUNCH_LOCKED_HREFS) on Friday
// to unlock both the IG Follower Hijack and TikTok AI Slideshow Masterclass
// sidebar rows + their /follower-hijack and /tiktok-slideshow-masterclass
// pages. This single flag is wired into:
//   - artifacts/room30-portal/src/components/portal-layout.tsx (sidebar)
//   - artifacts/room30-portal/src/pages/follower-hijack.tsx (page body)
//   - artifacts/room30-portal/src/pages/tiktok-slideshow-masterclass.tsx (page body)
export const PRELAUNCH_LOCKED = false;

export const PRELAUNCH_LOCKED_HREFS: ReadonlySet<string> = new Set([
  "/follower-hijack",
  "/tiktok-slideshow-masterclass",
]);

export const PRELAUNCH_LOCK_MESSAGE = "Coming Soon - dropping Friday 15th";

export function isPrelaunchLocked(href: string): boolean {
  return PRELAUNCH_LOCKED && PRELAUNCH_LOCKED_HREFS.has(href);
}
