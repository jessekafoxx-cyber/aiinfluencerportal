import { ExternalLink } from "lucide-react";
import { DfySubPageShell } from "@/components/dfy-sub-page-shell";

type StoryPack = {
  label: string;
  description: string;
  url: string;
};

const STORY_PACKS: StoryPack[] = [
  {
    label: "Pack 1",
    description:
      "Promo, poll, and hook-then-link story templates - duplicate in Canva and swap your copy.",
    url: "https://canva.link/pp3et1lstbhx0xp",
  },
  {
    label: "Pack 2",
    description:
      "More plug-and-play story frames for launches, testimonials, and link stickers.",
    url: "https://canva.link/7iozmgssg732jpw",
  },
];

export default function DfyIgStoryTemplates() {
  return (
    <DfySubPageShell
      title="100+ IG Story Templates"
      description="Pre-built Instagram story templates for promos, polls, hook-then-link sequences, and more."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {STORY_PACKS.map((pack, i) => (
          <a
            key={pack.url}
            href={pack.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-7 flex flex-col hover:border-[#C9A44C]/40 transition-colors"
          >
            <div className="flex items-center justify-between mb-6">
              <span
                className="inline-flex items-center justify-center w-11 h-11 rounded-full border border-[#C9A44C]/40 text-[#C9A44C] text-[15px] font-bold"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[10px] text-[#C9A44C] font-bold uppercase tracking-[0.22em]">
                Canva Pack
              </span>
            </div>

            <h3
              className="text-[24px] md:text-[26px] font-bold uppercase tracking-[0.01em] text-white leading-[1.1] mb-3"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              {pack.label}
            </h3>
            <p className="text-[13.5px] text-white/55 leading-[1.6] mb-7 flex-1">
              {pack.description}
            </p>

            <span className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.18em] text-[#C9A44C] group-hover:text-[#e0b95a] transition-colors">
              Open in Canva
              <ExternalLink className="w-3.5 h-3.5" />
            </span>
          </a>
        ))}
      </div>
    </DfySubPageShell>
  );
}
