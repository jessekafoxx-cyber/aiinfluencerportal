import { ExternalLink } from "lucide-react";
import { DfySubPageShell } from "@/components/dfy-sub-page-shell";

// TODO: replace with tutorial video URL
const TUTORIAL_VIDEO_URL = "#";

type Pack = {
  number: number;
  title: string;
  helper: string;
  canvaUrl: string;
  tutorialUrl?: string;
};

const PACKS: Pack[] = [
  {
    number: 1,
    title: "Viral Carousel Pack 01",
    helper: "Drop-in Canva carousels - swap copy and images, then post.",
    canvaUrl: "https://canva.link/d1c2dvq4unbgtp8",
  },
  {
    number: 2,
    title: "Viral Carousel Pack 02",
    helper: "Drop-in Canva carousels - swap copy and images, then post.",
    canvaUrl: "https://canva.link/c0o40dc4gljcuxo",
  },
  {
    number: 3,
    title: "Viral Carousel Pack 03",
    helper: "Drop-in Canva carousels - swap copy and images, then post.",
    canvaUrl: "https://canva.link/rsweytw3wgoukfy",
  },
  {
    number: 4,
    title: "Viral Carousel Pack 04",
    helper: "Drop-in Canva carousels - swap copy and images, then post.",
    canvaUrl: "https://canva.link/5pdtl20n123yc9h",
  },
  {
    number: 5,
    title: "Viral Carousel Pack 05",
    helper: "Drop-in Canva carousels - swap copy and images, then post.",
    canvaUrl: "https://canva.link/diovy7ggwmb6jgp",
  },
  {
    number: 6,
    title: "Viral Carousel Pack 06",
    helper: "Includes split-image carousels - watch the tutorial below before exporting.",
    canvaUrl: "https://canva.link/x0zwawuect8tbsz",
    tutorialUrl: TUTORIAL_VIDEO_URL,
  },
];

export default function DfyCarouselTemplates() {
  return (
    <DfySubPageShell
      title="50+ Viral Carousel Templates"
      description="Proven carousel layouts ready to drop into Instagram - swap copy and images, post."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {PACKS.map((pack) => (
          <div
            key={pack.number}
            className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-6 flex flex-col"
          >
            <p className="text-[11px] text-[#C9A44C] font-bold uppercase tracking-[0.22em] mb-2">
              Pack {String(pack.number).padStart(2, "0")}
            </p>
            <h2
              className="text-[20px] font-bold uppercase tracking-[0.01em] text-white leading-[1.15] mb-2"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              {pack.title}
            </h2>
            <p className="text-[13.5px] text-white/55 leading-[1.6] mb-5 flex-1">
              {pack.helper}
            </p>
            <a
              href={pack.canvaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-[#C9A44C] text-black text-[13px] font-bold uppercase tracking-[0.12em] hover:bg-[#d6b25c] transition-colors"
            >
              Open in Canva
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            {pack.tutorialUrl ? (
              <a
                href={pack.tutorialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 text-center text-[12px] text-[#C9A44C]/80 hover:text-[#C9A44C] underline underline-offset-4"
              >
                Watch the tutorial for the image splitter
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </DfySubPageShell>
  );
}
