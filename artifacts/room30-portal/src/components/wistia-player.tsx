import { createElement, memo, useEffect, type ReactNode } from "react";

// Wistia's current web-component player. The legacy E-v1.js + `wistia_async_`
// embed rendered "media not found" for newer library videos, so we render the
// modern `<wistia-player>` element instead. It needs two scripts:
//   1. player.js (loaded once, registers the custom element)
//   2. embed/<mediaId>.js (one per media, ES module, registers the media)
const PLAYER_JS_SRC = "https://fast.wistia.com/player.js";

function mediaScriptSrc(mediaId: string) {
  return `https://fast.wistia.com/embed/${mediaId}.js`;
}

function ensurePlayerScript() {
  if (typeof document === "undefined") return;
  if (document.querySelector(`script[src="${PLAYER_JS_SRC}"]`)) return;
  const s = document.createElement("script");
  s.src = PLAYER_JS_SRC;
  s.async = true;
  document.head.appendChild(s);
}

// Per-media scripts are reference-counted so that (a) two players sharing the
// same media only inject one script, (b) the tag is removed once no player
// needs it (so a long session switching recordings does not leak orphaned
// scripts into <head>), and (c) a script that FAILS to load is dropped so a
// later mount retries instead of a sticky failed tag blocking reinsertion.
type MediaEntry = { count: number; script: HTMLScriptElement | null };
const mediaRegistry = new Map<string, MediaEntry>();

function acquireMediaScript(mediaId: string) {
  if (typeof document === "undefined") return;
  let entry = mediaRegistry.get(mediaId);
  if (!entry) {
    entry = { count: 0, script: null };
    mediaRegistry.set(mediaId, entry);
  }
  entry.count += 1;
  if (!entry.script || !entry.script.isConnected) {
    const s = document.createElement("script");
    s.src = mediaScriptSrc(mediaId);
    s.async = true;
    s.type = "module";
    s.setAttribute("data-wistia-media", mediaId);
    s.addEventListener("error", () => {
      s.remove();
      const cur = mediaRegistry.get(mediaId);
      if (cur && cur.script === s) cur.script = null;
    });
    document.head.appendChild(s);
    entry.script = s;
  }
}

function releaseMediaScript(mediaId: string) {
  if (typeof document === "undefined") return;
  const entry = mediaRegistry.get(mediaId);
  if (!entry) return;
  entry.count -= 1;
  if (entry.count <= 0) {
    entry.script?.remove();
    mediaRegistry.delete(mediaId);
  }
}

// One global style so the custom element always fills the box we give it.
function ensureFillStyle() {
  if (typeof document === "undefined") return;
  if (document.querySelector("style[data-wistia-fill]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-wistia-fill", "true");
  style.textContent =
    "wistia-player{display:block;width:100%;height:100%;}";
  document.head.appendChild(style);
}

type WistiaPlayerProps = {
  mediaId: string;
  className?: string;
  title?: string;
  /**
   * Optional width/height ratio. If provided, the component renders its own
   * padding-top aspect wrapper. If omitted, the parent is responsible for
   * sizing (e.g. a Tailwind `aspect-video` wrapper).
   */
  aspect?: number;
};

function WistiaPlayerInner({ mediaId, className, title, aspect }: WistiaPlayerProps) {
  useEffect(() => {
    ensureFillStyle();
    ensurePlayerScript();
    acquireMediaScript(mediaId);
    return () => releaseMediaScript(mediaId);
  }, [mediaId]);

  // `wistia-player` is a custom element; createElement avoids JSX intrinsic
  // typing friction. It fills its parent (see ensureFillStyle).
  const player = createElement("wistia-player", {
    key: mediaId,
    "media-id": mediaId,
    ...(title ? { "aria-label": title } : {}),
    style: { width: "100%", height: "100%", display: "block" },
  });

  // Suppress right-click (casual "Save video as" / inspect deterrent).
  const playerLayer = (
    <div
      style={{ position: "relative", width: "100%", height: "100%" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {player}
    </div>
  );

  return aspectWrapper(playerLayer, className, aspect);
}

function aspectWrapper(child: ReactNode, className?: string, aspect?: number) {
  if (aspect && aspect > 0) {
    const paddingTop = `${(1 / aspect) * 100}%`;
    return (
      <div className={className} style={{ position: "relative", width: "100%", paddingTop }}>
        <div style={{ position: "absolute", inset: 0 }}>{child}</div>
      </div>
    );
  }
  return <div className={className}>{child}</div>;
}

// memo on mediaId so parent re-renders (mark complete, action-task toggle,
// admin edits, brief saves) never remount the embed container. The video
// only reloads when the actual mediaId prop changes.
export const WistiaPlayer = memo(WistiaPlayerInner, (prev, next) => {
  return (
    prev.mediaId === next.mediaId &&
    prev.className === next.className &&
    prev.title === next.title &&
    prev.aspect === next.aspect
  );
});
