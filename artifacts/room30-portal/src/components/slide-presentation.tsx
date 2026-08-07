import { useState, useEffect, useCallback, useMemo } from "react";
import { X, ChevronLeft, ChevronRight, Maximize2, Minimize2, Download } from "lucide-react";

export type Slide = {
  content: string;
  notes?: string;
  imageUrl?: string;
};

type Props = {
  slides: Slide[];
  title?: string;
  proofImages?: string[];
  onClose: () => void;
};

const SLIDE_FONT = "Raleway, system-ui, -apple-system, sans-serif";
const BASE_SIZE = 36;

const SECTION_LABELS = new Set([
  "our offer is simple",
  "here's the problem",
  "here is the problem",
  "the problem",
  "the solution",
  "first cta",
  "results",
  "proof",
  "results / proof",
  "results & proof",
  "worst-case scenario",
  "worst case scenario",
  "objection handling",
  "objections",
  "qualifier",
  "final cta",
  "qualifier + final cta",
  "bold offer statement",
  "pain points",
  "solution statement",
  "results / proof walkthrough",
]);

const isSectionLabelOnly = (content: string): boolean => {
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length !== 1) return false;
  const norm = lines[0].toLowerCase().replace(/[:.\-—]+$/g, "").replace(/\s+/g, " ").trim();
  return SECTION_LABELS.has(norm);
};

const stripBoldMarkers = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1");

const renderInlineBold = (text: string, key: string | number) => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) {
          return <strong key={`${key}-${i}`} className="font-bold">{p.slice(2, -2)}</strong>;
        }
        return <span key={`${key}-${i}`}>{p}</span>;
      })}
    </>
  );
};

export async function exportSlidesToPptx(slides: Slide[], title: string, proofImages: string[] = []) {
  return exportToPptx(slides, title, proofImages);
}

async function exportToPptx(slides: Slide[], title: string, proofImages: string[]) {
  const pptxgenjs = await import("pptxgenjs");
  const PptxGenJS = pptxgenjs.default;
  const pres = new PptxGenJS();

  pres.layout = "LAYOUT_WIDE";
  pres.author = "Low Ticket Acquisition OS";
  pres.title = title || "VSL Slides";

  const renderable = slides.filter(s => !isSectionLabelOnly(s.content || ""));

  for (const slide of renderable) {
    const pptSlide = pres.addSlide();
    pptSlide.background = { color: "FFFFFF" };

    const lines = slide.content.split("\n").map(l => l.trim()).filter(Boolean);

    const imageLines = lines.filter(l => l.startsWith("[INSERT"));
    const textLines = lines.filter(l => !l.startsWith("[INSERT"));

    const bulletLines = textLines.filter(l => l.startsWith("✅") || l.startsWith("👉"));
    const headingLines = textLines.filter(l => !l.startsWith("✅") && !l.startsWith("👉"));
    const isBulletLayout = bulletLines.length >= 1 && headingLines.length >= 1;

    if (isBulletLayout) {
      pptSlide.addText(
        headingLines.map(h => ({
          text: stripBoldMarkers(h),
          options: { fontSize: 36, fontFace: "Raleway", color: "1a1a1a", bold: true, breakLine: true },
        })),
        { x: 0.7, y: 0.6, w: 12.0, h: 1.6, valign: "top", align: "left" }
      );

      const yStart = 2.4;
      const lineHeight = 0.7;
      pptSlide.addText(
        bulletLines.map(b => ({
          text: stripBoldMarkers(b),
          options: { fontSize: 32, fontFace: "Raleway", color: "1a1a1a", breakLine: true, paraSpaceAfter: 14 },
        })),
        { x: 0.9, y: yStart, w: 11.5, h: 6.5 - yStart, valign: "top", align: "left" }
      );
    } else if (textLines.length > 0) {
      pptSlide.addText(
        textLines.map(line => ({
          text: stripBoldMarkers(line),
          options: { fontSize: 36, fontFace: "Raleway", color: "1a1a1a", bold: true, align: "center", breakLine: true, paraSpaceAfter: 12 },
        })),
        { x: 0.5, y: 0.5, w: 12.3, h: 6.5, valign: "middle", align: "center" }
      );
    }

    for (const imgLine of imageLines) {
      const matchIdx = parseInt(imgLine.match(/\d+/)?.[0] || "0", 10) - 1;
      const imgUrl = proofImages[matchIdx];
      if (imgUrl) {
        try {
          const resp = await fetch(imgUrl);
          const blob = await resp.blob();
          const reader = new FileReader();
          const dataUrl: string = await new Promise((resolve) => {
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          const hasText = textLines.length > 0;
          pptSlide.addImage({
            data: dataUrl,
            x: hasText ? 3.0 : 2.5,
            y: hasText ? 3.5 : 1.0,
            w: hasText ? 7.3 : 8.3,
            h: hasText ? 3.3 : 5.5,
            sizing: { type: "contain", w: hasText ? 7.3 : 8.3, h: hasText ? 3.3 : 5.5 },
          });
        } catch {}
      }
    }

    if (slide.notes) {
      pptSlide.addNotes(slide.notes);
    }
  }

  await pres.writeFile({ fileName: `${title || "VSL Slides"}.pptx` });
}

export function SlidePresentation({ slides, title, proofImages = [], onClose }: Props) {
  const visibleSlides = useMemo(
    () => slides.filter(s => !isSectionLabelOnly(s.content || "")),
    [slides]
  );

  const [current, setCurrent] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const goNext = useCallback(() => {
    setCurrent(prev => Math.min(prev + 1, visibleSlides.length - 1));
  }, [visibleSlides.length]);

  const goPrev = useCallback(() => {
    setCurrent(prev => Math.max(prev - 1, 0));
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportToPptx(slides, title || "VSL Slides", proofImages);
    } catch (e) {
      console.error("PPTX export failed:", e);
    } finally {
      setExporting(false);
    }
  }, [slides, title, proofImages]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); goNext(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      if (e.key === "Escape") {
        if (document.fullscreenElement) {
          document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
        } else {
          onClose();
        }
      }
      if (e.key === "f" || e.key === "F") toggleFullscreen();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, onClose, toggleFullscreen]);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  if (!visibleSlides.length) return null;
  const slide = visibleSlides[current];

  const lines = (slide.content || "").split("\n").map(l => l.trim()).filter(Boolean);
  const imageLines = lines.filter(l => l.startsWith("[INSERT"));
  const textLines = lines.filter(l => !l.startsWith("[INSERT"));
  const bulletLines = textLines.filter(l => l.startsWith("✅") || l.startsWith("👉"));
  const headingLines = textLines.filter(l => !l.startsWith("✅") && !l.startsWith("👉"));
  const isBulletLayout = bulletLines.length >= 1 && headingLines.length >= 1;

  const renderImages = () => imageLines.map((line, i) => {
    const matchIdx = parseInt(line.match(/\d+/)?.[0] || "0", 10) - 1;
    const imgUrl = proofImages[matchIdx];
    return (
      <div key={`img-${i}`} className="flex items-center justify-center">
        {imgUrl ? (
          <img src={imgUrl} alt="Proof" className="max-w-full max-h-[55vh] rounded-lg shadow-md object-contain" />
        ) : (
          <div className="px-8 py-6 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 text-[18px] font-medium">
            {line}
          </div>
        )}
      </div>
    );
  });

  return (
    <div className="fixed inset-0 z-[200] bg-white flex flex-col" style={{ fontFamily: SLIDE_FONT }}>
      {!isFullscreen && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="h-10 px-3 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center gap-2 text-gray-500 transition-colors text-[12px] font-medium disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {exporting ? "Exporting..." : "Download .pptx"}
          </button>
          <button
            onClick={toggleFullscreen}
            className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors"
          >
            <Maximize2 className="w-5 h-5" />
          </button>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      <div
        className="flex-1 flex items-center justify-center cursor-pointer select-none px-12 md:px-24 py-16"
        onClick={goNext}
        style={{ fontFamily: SLIDE_FONT }}
      >
        {isBulletLayout ? (
          <div className="max-w-[1100px] w-full" style={{ fontFamily: SLIDE_FONT }}>
            {headingLines.map((h, i) => (
              <p
                key={`h-${i}`}
                className="text-[#1a1a1a] font-bold mb-6 leading-[1.25]"
                style={{ fontSize: `${BASE_SIZE}px`, fontFamily: SLIDE_FONT }}
              >
                {renderInlineBold(h, `h-${i}`)}
              </p>
            ))}
            <div className="space-y-3 mt-2">
              {bulletLines.map((b, i) => (
                <p
                  key={`b-${i}`}
                  className="text-[#1a1a1a] leading-[1.4] font-medium"
                  style={{ fontSize: `${BASE_SIZE - 4}px`, fontFamily: SLIDE_FONT }}
                >
                  {renderInlineBold(b, `b-${i}`)}
                </p>
              ))}
            </div>
            {imageLines.length > 0 && <div className="mt-8 grid gap-4">{renderImages()}</div>}
          </div>
        ) : (
          <div className="max-w-[1100px] w-full text-center" style={{ fontFamily: SLIDE_FONT }}>
            {textLines.map((line, i) => (
              <p
                key={i}
                className="text-[#1a1a1a] font-bold leading-[1.3] mb-3"
                style={{ fontSize: `${BASE_SIZE}px`, fontFamily: SLIDE_FONT }}
              >
                {renderInlineBold(line, i)}
              </p>
            ))}
            {imageLines.length > 0 && <div className="mt-8 grid gap-4">{renderImages()}</div>}
          </div>
        )}
      </div>

      {!isFullscreen && (
        <div className="shrink-0 h-14 border-t border-gray-100 flex items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); goPrev(); }}
              disabled={current === 0}
              className="w-9 h-9 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); goNext(); }}
              disabled={current === visibleSlides.length - 1}
              className="w-9 h-9 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <p className="text-[13px] text-gray-400 font-medium">
            {current + 1} / {visibleSlides.length}
            {title && <span className="ml-3 text-gray-300">— {title}</span>}
          </p>

          <p className="text-[11px] text-gray-300">
            Arrow keys to navigate · F for fullscreen · ESC to exit
          </p>
        </div>
      )}

      {slide.notes && !isFullscreen && (
        <div className="shrink-0 bg-gray-50 border-t border-gray-100 px-6 py-2">
          <p className="text-[11px] text-gray-400 italic">{slide.notes}</p>
        </div>
      )}
    </div>
  );
}
