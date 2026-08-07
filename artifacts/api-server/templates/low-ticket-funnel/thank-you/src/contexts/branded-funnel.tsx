import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

const THEME_COLORS: Record<string, { primary: string; primaryRgb: string; dark: string; darkRgb: string; card: string; cardRgb: string; buttonText: string; accent: string }> = {
  pink: { primary: "#E91E8C", primaryRgb: "233,30,140", dark: "#1a0a12", darkRgb: "26,10,18", card: "#2a1020", cardRgb: "42,16,32", buttonText: "#ffffff", accent: "#FF6BB5" },
  green: { primary: "#93E360", primaryRgb: "147,227,96", dark: "#051408", darkRgb: "5,20,8", card: "#111613", cardRgb: "17,22,19", buttonText: "#051408", accent: "#B5FF7D" },
  blue: { primary: "#4A90D9", primaryRgb: "74,144,217", dark: "#0a1628", darkRgb: "10,22,40", card: "#111827", cardRgb: "17,24,39", buttonText: "#ffffff", accent: "#6DB3F8" },
  red: { primary: "#E53E3E", primaryRgb: "227,62,62", dark: "#1a0a0a", darkRgb: "26,10,10", card: "#2a1111", cardRgb: "42,17,17", buttonText: "#ffffff", accent: "#FC6B6B" },
  "black-gold": { primary: "#D4A843", primaryRgb: "212,168,67", dark: "#0a0a0a", darkRgb: "10,10,10", card: "#1a1a1a", cardRgb: "26,26,26", buttonText: "#0a0a0a", accent: "#F2D072" },
  "white-black": { primary: "#1a1a1a", primaryRgb: "26,26,26", dark: "#f5f5f5", darkRgb: "245,245,245", card: "#ffffff", cardRgb: "255,255,255", buttonText: "#ffffff", accent: "#333333" },
};

export type ThemeColors = typeof THEME_COLORS[string];

export interface FunnelBranding {
  slug: string;
  influencerName: string;
  brandColorTheme: string;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  avatarProfileUrl: string | null;
  trackingCode: string | null;
  isActive: boolean;
  theme: ThemeColors;
  isBranded: boolean;
}

const defaultBranding: FunnelBranding = {
  slug: "",
  influencerName: "",
  brandColorTheme: "green",
  logoLightUrl: null,
  logoDarkUrl: null,
  avatarProfileUrl: null,
  trackingCode: null,
  isActive: true,
  theme: THEME_COLORS.green,
  isBranded: false,
};

interface BrandedFunnelContextValue extends FunnelBranding {
  loadSlug: (slug: string) => void;
}

const BrandedFunnelContext = createContext<BrandedFunnelContextValue>({ ...defaultBranding, loadSlug: () => {} });

export function useBrandedFunnel() {
  return useContext(BrandedFunnelContext);
}

const SESSION_KEY = "aip_portfolio_slug";

export function setPortfolioSlug(slug: string) {
  try { sessionStorage.setItem(SESSION_KEY, slug); } catch {}
}

export function getPortfolioSlug(): string | null {
  try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}

export function clearPortfolioSlug() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

export function BrandedFunnelProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<FunnelBranding>(defaultBranding);

  const fetchBranding = useCallback((slug: string) => {
    fetch(`/api/public/funnel/${slug}`)
      .then(r => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then(data => {
        const theme = THEME_COLORS[data.brandColorTheme] || THEME_COLORS.green;
        setBranding({
          slug: data.slug,
          influencerName: data.influencerName,
          brandColorTheme: data.brandColorTheme,
          logoLightUrl: data.logoLightUrl,
          logoDarkUrl: data.logoDarkUrl,
          avatarProfileUrl: data.avatarProfileUrl,
          trackingCode: data.trackingCode,
          isActive: data.isActive,
          theme,
          isBranded: true,
        });
      })
      .catch(() => {
        clearPortfolioSlug();
      });
  }, []);

  const loadSlug = useCallback((slug: string) => {
    setPortfolioSlug(slug);
    fetchBranding(slug);
  }, [fetchBranding]);

  useEffect(() => {
    const slug = getPortfolioSlug();
    if (slug) {
      fetchBranding(slug);
    }
  }, [fetchBranding]);

  const contextValue: BrandedFunnelContextValue = { ...branding, loadSlug };

  return (
    <BrandedFunnelContext.Provider value={contextValue}>
      {branding.isBranded && branding.brandColorTheme !== "green" && (
        <ThemeOverrideStyles theme={branding.theme} />
      )}
      {branding.isBranded && branding.trackingCode && (
        <TrackingCodeInjector code={branding.trackingCode} />
      )}
      {children}
    </BrandedFunnelContext.Provider>
  );
}

function TrackingCodeInjector({ code }: { code: string }) {
  useEffect(() => {
    if (!code) return;
    try { sessionStorage.setItem("portfolio_ref", code); } catch {}
    const params = new URLSearchParams(window.location.search);
    if (!params.has("ref")) {
      const url = new URL(window.location.href);
      url.searchParams.set("ref", code);
      window.history.replaceState({}, "", url.toString());
    }
  }, [code]);
  return null;
}

function ThemeOverrideStyles({ theme }: { theme: ThemeColors }) {
  useEffect(() => {
    function recolor() {
      const elements = document.querySelectorAll("*");
      elements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        const style = htmlEl.style;

        if (style.color === "rgb(147, 227, 96)" || style.color === "#93E360" || style.color === "#93e360") {
          style.color = theme.primary;
        }
        if (style.backgroundColor === "rgb(147, 227, 96)" || style.backgroundColor === "#93E360" || style.backgroundColor === "#93e360") {
          style.backgroundColor = theme.primary;
          style.color = theme.buttonText;
        }
        if (style.backgroundColor === "rgb(5, 20, 8)" || style.backgroundColor === "#051408") {
          style.backgroundColor = theme.dark;
        }
        if (style.backgroundColor === "rgb(17, 22, 19)" || style.backgroundColor === "#111613") {
          style.backgroundColor = theme.card;
        }
        if (style.borderColor === "#93E360" || style.borderColor === "rgb(147, 227, 96)" || style.borderColor === "#93e360") {
          style.borderColor = theme.primary;
        }

        const bg = style.background;
        if (bg) {
          let newBg = bg;
          newBg = newBg.replace(/rgb\(147,\s*227,\s*96\)/g, theme.primary);
          newBg = newBg.replace(/#93E360/gi, theme.primary);
          newBg = newBg.replace(/rgba\(147,\s*227,\s*96/g, `rgba(${theme.primaryRgb}`);
          newBg = newBg.replace(/#051408/gi, theme.dark);
          newBg = newBg.replace(/rgb\(5,\s*20,\s*8\)/g, theme.dark);
          newBg = newBg.replace(/rgba\(5,\s*20,\s*8/g, `rgba(${theme.darkRgb}`);
          newBg = newBg.replace(/#111613/gi, theme.card);
          newBg = newBg.replace(/rgb\(17,\s*22,\s*19\)/g, theme.card);
          newBg = newBg.replace(/rgba\(17,\s*22,\s*19/g, `rgba(${theme.cardRgb}`);
          if (newBg !== bg) style.background = newBg;
        }

        const boxShadow = style.boxShadow;
        if (boxShadow && (boxShadow.includes("147, 227, 96") || boxShadow.includes("147,227,96"))) {
          style.boxShadow = boxShadow.replace(/rgba?\(147,\s*227,\s*96/g, `rgba(${theme.primaryRgb}`);
        }

        const border = style.border;
        if (border) {
          let nb = border.replace(/#93E360/gi, theme.primary).replace(/rgba\(147,\s*227,\s*96/g, `rgba(${theme.primaryRgb}`);
          if (nb !== border) style.border = nb;
        }
        const borderBottom = style.borderBottom;
        if (borderBottom) {
          let nb = borderBottom.replace(/#93E360/gi, theme.primary).replace(/rgba\(147,\s*227,\s*96/g, `rgba(${theme.primaryRgb}`);
          if (nb !== borderBottom) style.borderBottom = nb;
        }
        const borderTop = style.borderTop;
        if (borderTop) {
          let nb = borderTop.replace(/#93E360/gi, theme.primary).replace(/rgba\(147,\s*227,\s*96/g, `rgba(${theme.primaryRgb}`);
          if (nb !== borderTop) style.borderTop = nb;
        }
        const borderLeft = style.borderLeft;
        if (borderLeft) {
          let nb = borderLeft.replace(/#93E360/gi, theme.primary).replace(/rgba\(147,\s*227,\s*96/g, `rgba(${theme.primaryRgb}`);
          if (nb !== borderLeft) style.borderLeft = nb;
        }
        const outline = style.outline;
        if (outline) {
          let no = outline.replace(/#93E360/gi, theme.primary);
          if (no !== outline) style.outline = no;
        }
      });

      document.querySelectorAll('svg [fill="#93E360"], svg [fill="#93e360"]').forEach(el => {
        (el as SVGElement).setAttribute("fill", theme.primary);
      });
      document.querySelectorAll('svg [stroke="#93E360"], svg [stroke="#93e360"]').forEach(el => {
        (el as SVGElement).setAttribute("stroke", theme.primary);
      });
    }

    const timer1 = setTimeout(recolor, 50);
    const timer2 = setTimeout(recolor, 300);
    const timer3 = setTimeout(recolor, 1000);
    const timer4 = setTimeout(recolor, 2500);

    const observer = new MutationObserver(() => {
      requestAnimationFrame(recolor);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(timer4);
      observer.disconnect();
    };
  }, [theme]);

  return (
    <style>{`
      [style*="rgb(147, 227, 96)"],
      [style*="#93E360"],
      [style*="#93e360"] {
        --tw-text-opacity: 1;
      }
    `}</style>
  );
}

export { THEME_COLORS };
