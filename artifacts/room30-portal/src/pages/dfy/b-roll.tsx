import { ExternalLink, Folder, Palette } from "lucide-react";
import { DfySubPageShell } from "@/components/dfy-sub-page-shell";

type PackKind = "drive" | "canva";
type Pack = { number: number; url: string; kind: PackKind };

const PACKS: Pack[] = [
  { number: 1, kind: "drive", url: "https://drive.google.com/drive/folders/17-rs-4L7DtkVKEl5e5XTmgbDMiUt9f1T?usp=sharing" },
  { number: 2, kind: "drive", url: "https://drive.google.com/drive/folders/12PJSdiD-iEjst_suZdVLwxwh-xVbUpKT" },
  { number: 3, kind: "drive", url: "https://drive.google.com/drive/folders/1VCkYBk8CCHs3-DrZtAbliACMNw9JfDzF" },
  { number: 4, kind: "drive", url: "https://drive.google.com/drive/folders/1nGtZ3hySaN_FNxCghtjE-65ENtjMmBeu" },
  { number: 5, kind: "drive", url: "https://drive.google.com/drive/folders/1wGL5xovawKRzse_SzAehSMH9UnYt2Yap" },
  { number: 6, kind: "drive", url: "https://drive.google.com/drive/folders/1yEMCm-oRth4D7BrObSaBCcIX7L3FD-ru" },
  { number: 7, kind: "drive", url: "https://drive.google.com/drive/folders/1yM3OmqmxToXcGsE-OttfU_2jCUOOoFLN" },
  { number: 8, kind: "drive", url: "https://drive.google.com/drive/folders/1yM3OmqmxToXcGsE-OttfU_2jCUOOoFLN" },
  { number: 9, kind: "canva", url: "https://www.canva.com/design/DAGuFBS6ZGI/tSE_VZuakfOCtAVqlb-Y6A/view?utm_content=DAGuFBS6ZGI&utm_campaign=designshare&utm_medium=link&utm_source=publishsharelink&mode=preview" },
  { number: 10, kind: "canva", url: "https://www.canva.com/design/DAGuFBKx8_Y/LZP_KdE_SsDbyfKNtDlLCQ/view?utm_content=DAGuFBKx8_Y&utm_campaign=designshare&utm_medium=link&utm_source=publishsharelink&mode=preview" },
  { number: 11, kind: "canva", url: "https://www.canva.com/design/DAGuFKWmkh8/55WEPQg3HMaiCrmpQ0sfUw/view?utm_content=DAGuFKWmkh8&utm_campaign=designshare&utm_medium=link&utm_source=publishsharelink&mode=preview" },
  { number: 12, kind: "drive", url: "https://drive.google.com/drive/folders/12h2S8oNdUP6T9LQ_Q2cKKFNkWxNl74ne" },
  { number: 13, kind: "drive", url: "https://drive.google.com/drive/folders/1C4fg9DhLUKccdRiB84b8VBNFyKCZ0ZIg" },
  { number: 14, kind: "drive", url: "https://drive.google.com/drive/folders/14e-wpQIfoV2yfesDSzoJ7LKc2esIcbHd" },
  { number: 15, kind: "drive", url: "https://drive.google.com/drive/folders/1ebjv6f_zEYUrftkgIZeXF3DT5cvj-9L0" },
  { number: 16, kind: "drive", url: "https://drive.google.com/drive/folders/112wBwxWxlAyE20EwnkREE_wNSftknUjZ" },
  { number: 17, kind: "drive", url: "https://drive.google.com/drive/folders/13nPjaYBOdl42LzosB3m5pEgGuLDncRZM" },
  { number: 18, kind: "drive", url: "https://drive.google.com/drive/folders/14e-wpQIfoV2yfesDSzoJ7LKc2esIcbHd" },
  { number: 19, kind: "drive", url: "https://drive.google.com/drive/folders/1Idg7wvP5qQRZdOX4OJyDqssm35dL2kf2" },
  { number: 20, kind: "drive", url: "https://drive.google.com/drive/folders/1RDkSmTGbg7NPmltQOQcIvvaoukzy18B_" },
  { number: 21, kind: "drive", url: "https://drive.google.com/drive/folders/1guiG-kGfQ_JmDjryh2-jJzmgSOKhCzpX" },
];

export default function DfyBRoll() {
  return (
    <DfySubPageShell
      title="70K Viral Video B-Roll"
      description="Tens of thousands of pre-organised b-roll clips ready to layer over your hooks, demos and overlays. Browse, preview and download every clip without leaving the portal."
    >
      <div className="flex items-center justify-between mb-5">
        <p className="text-[12.5px] text-white/45">{PACKS.length} packs</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {PACKS.map((pack) => {
          const isCanva = pack.kind === "canva";
          const Icon = isCanva ? Palette : Folder;
          const kindLabel = isCanva ? "Canva" : "Drive";
          return (
            <a
              key={pack.number}
              href={pack.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-4 aspect-[3/4] flex flex-col justify-between hover:border-[#C9A44C]/40 hover:bg-[#141414] transition-colors"
            >
              <div className="flex items-start justify-between">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] px-2 py-1 rounded-full bg-white/[0.06] text-white/70 border border-white/[0.06]">
                  <Icon className="w-3 h-3" />
                  {kindLabel}
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-white/35 group-hover:text-[#C9A44C] transition-colors" />
              </div>
              <div>
                <p className="text-[11px] text-[#C9A44C] font-bold uppercase tracking-[0.18em] mb-1">
                  Pack {pack.number}
                </p>
                <p
                  className="text-[20px] md:text-[24px] font-bold uppercase tracking-[0.01em] text-white leading-[1.05]"
                  style={{ fontFamily: "var(--app-font-display)" }}
                >
                  {String(pack.number).padStart(2, "0")}
                </p>
              </div>
            </a>
          );
        })}
      </div>
    </DfySubPageShell>
  );
}
