import { ExternalLink, Sparkles } from "lucide-react";
import { DfySubPageShell } from "@/components/dfy-sub-page-shell";

type StoryHighlightPack = {
  title: string;
  description: string;
  canvaUrl: string;
};

const STORY_HIGHLIGHT_PACKS: StoryHighlightPack[] = [
  {
    title: "Instagram Story Highlights - Vol. 1",
    description:
      "A clean, on-brand set of Instagram story highlight covers - duplicate the Canva template, swap colors and icons, and ship to your profile in minutes.",
    canvaUrl: "https://canva.link/0mgeiq1c0m8unnc",
  },
];

export default function DfyIgStoryHighlights() {
  return (
    <DfySubPageShell
      title="Instagram Story Highlights"
      description="Editable Canva story highlight covers you can duplicate, restyle, and pin to your profile."
    >
      <div className="grid grid-cols-1 gap-5">
        {STORY_HIGHLIGHT_PACKS.map((pack) => (
          <div
            key={pack.canvaUrl}
            className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-6 hover:border-white/[0.14] transition-colors"
          >
            <div className="shrink-0 w-12 h-12 rounded-xl bg-[#C9A44C]/10 border border-[#C9A44C]/25 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[#C9A44C]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-[#C9A44C] font-bold uppercase tracking-[0.22em] mb-2">
                Canva Template
              </p>
              <h3
                className="text-[20px] md:text-[22px] font-bold uppercase tracking-[0.01em] text-white leading-[1.15] mb-2"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                {pack.title}
              </h3>
              <p className="text-[13.5px] text-white/60 leading-[1.65]">
                {pack.description}
              </p>
            </div>
            <a
              href={pack.canvaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center justify-center gap-2 bg-[#C9A44C] text-black font-bold text-[12px] uppercase tracking-[0.14em] px-6 py-3 rounded-lg hover:bg-[#dfb960] transition-colors"
            >
              Open in Canva
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        ))}
      </div>
      <p className="text-[12.5px] text-white/40 text-center mt-6">
        More coming soon
      </p>
    </DfySubPageShell>
  );
}
