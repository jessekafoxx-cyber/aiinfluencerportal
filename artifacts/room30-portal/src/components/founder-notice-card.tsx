export const FOUNDER_NOTICE_DISMISS_KEY = "room30:founder-notice-dismissed:v1";

// Local cache only - the source of truth is portal_users.founder_notice_dismissed_at
// surfaced via /portal/me. We still write the localStorage flag on dismiss so
// the modal hides instantly without waiting on the next /portal/me fetch.
export function isFounderNoticeDismissedLocally(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(FOUNDER_NOTICE_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

type FounderNoticeCardProps = {
  onDismiss?: () => void;
};

// The founder notice was a one-time, first-person letter about a specific
// platform migration. The copy is inherently personal to the original
// founder and time-bound, so there is nothing left to show once it is made
// brand-neutral. The component and its exports are kept so existing imports
// (and the /me/founder-notice/dismiss endpoint) keep compiling, but it
// renders nothing. To reintroduce a notice, render your own markup here and
// call `api.me.dismissFounderNotice()` from its dismiss handler.
export function FounderNoticeCard(_props: FounderNoticeCardProps) {
  return null;
}
