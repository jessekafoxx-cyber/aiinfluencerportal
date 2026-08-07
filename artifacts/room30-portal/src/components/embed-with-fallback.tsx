import { useEffect, useRef, useState } from "react";

/**
 * Renders a 16:9 embed iframe (Loom / YouTube / Vimeo) with a "Video not
 * loading?" fallback link beneath it. Some users have ad blockers, privacy
 * extensions, or blocked third-party cookies that stop the embedded player
 * from loading; the fallback link opens the video directly in a new tab.
 *
 * The link stays small and subtle when the video loads fine. If the iframe
 * has not fired onLoad within 5 seconds, the link is made more prominent so
 * the user notices it.
 */
function toWatchUrl(src: string): string {
  // Loom embed URL -> shareable watch URL (loom.com/embed/ID -> loom.com/share/ID).
  const loom = src.match(/loom\.com\/embed\/([a-zA-Z0-9]+)/);
  if (loom) return `https://www.loom.com/share/${loom[1]}`;
  return src;
}

export function EmbedWithFallback({
  src,
  title,
}: {
  src: string;
  title?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [escalate, setEscalate] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    loadedRef.current = false;
    setLoaded(false);
    setEscalate(false);
    const t = setTimeout(() => {
      if (!loadedRef.current) setEscalate(true);
    }, 5000);
    return () => clearTimeout(t);
  }, [src]);

  const watchUrl = toWatchUrl(src);

  return (
    <div>
      <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
        <iframe
          src={src}
          title={title}
          onLoad={() => {
            loadedRef.current = true;
            setLoaded(true);
            setEscalate(false);
          }}
          className="absolute inset-0 w-full h-full"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
        />
      </div>
      <a
        href={watchUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={
          escalate && !loaded
            ? "block text-center text-[13px] text-white/80 bg-white/[0.06] rounded px-3 py-2 mt-2 hover:text-white transition-colors"
            : "block text-center text-[11px] text-white/40 mt-1.5 hover:text-white/70 transition-colors"
        }
      >
        Video not loading? Click here to watch
      </a>
    </div>
  );
}
