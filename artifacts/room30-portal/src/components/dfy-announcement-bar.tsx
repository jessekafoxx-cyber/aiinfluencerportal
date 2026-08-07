export const DFY_BAR_DISMISS_KEY = "room30:dfy-announcement-dismissed:v1";
export const DFY_BAR_HEIGHT_PX = 36;

// The announcement bar existed solely to push an external "Done For You"
// sales page that is no longer part of this install. The component and its
// exports are kept so existing imports keep compiling, but the bar is
// permanently hidden: `isDfyBarDismissed()` always reports dismissed (so no
// vertical offset is reserved) and the component renders nothing. To bring
// a bar back, restore the markup below and drive the dismissed flag from
// localStorage again.
export function isDfyBarDismissed(): boolean {
  return true;
}

type DfyAnnouncementBarProps = {
  onDismiss?: () => void;
};

export function DfyAnnouncementBar(_props: DfyAnnouncementBarProps) {
  return null;
}
