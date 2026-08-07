import { useEffect, useRef } from "react";

type Props = {
  url: string;
  height?: number;
  className?: string;
};

declare global {
  interface Window {
    Calendly?: {
      initInlineWidget: (opts: {
        url: string;
        parentElement: HTMLElement;
        prefill?: Record<string, any>;
        utm?: Record<string, any>;
      }) => void;
    };
  }
}

const SCRIPT_ID = "calendly-widget-script";
const SCRIPT_SRC = "https://assets.calendly.com/assets/external/widget.js";

let scriptPromise: Promise<void> | null = null;

function loadCalendlyScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Calendly) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve) => {
    const existing = document.getElementById(
      SCRIPT_ID,
    ) as HTMLScriptElement | null;
    if (existing) {
      if (window.Calendly) return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = SCRIPT_SRC;
    s.async = true;
    s.addEventListener("load", () => resolve(), { once: true });
    document.body.appendChild(s);
  });

  return scriptPromise;
}

export function CalendlyInline({ url, height = 700, className = "" }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadCalendlyScript().then(() => {
      if (cancelled || !ref.current || !window.Calendly) return;
      ref.current.innerHTML = "";
      window.Calendly.initInlineWidget({
        url,
        parentElement: ref.current,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div
      ref={ref}
      className={className}
      style={{ minWidth: "320px", height: `${height}px` }}
    />
  );
}
