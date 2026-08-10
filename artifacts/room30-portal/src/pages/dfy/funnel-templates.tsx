import { ExternalLink, Download } from "lucide-react";
import { DfySubPageShell } from "@/components/dfy-sub-page-shell";

const GHL_LINK = "https://www.gohighlevel.com/?fp_ref=justfunnel";

type FunnelTemplate = {
  number: number;
  previewLink: string;
  templateLink: string;
};

const FUNNEL_TEMPLATES: FunnelTemplate[] = [
  {
    number: 1,
    previewLink: "https://app.gohighlevel.com/v2/preview/nMPaAt4BmkKpWysjyPFx",
    templateLink:
      "https://affiliates.gohighlevel.com/?fp_ref=gcooke&funnel_share=6a05826f89673005d6f54326",
  },
  {
    number: 2,
    previewLink: "https://app.gohighlevel.com/v2/preview/g205IFvwYfG177aAVOt6",
    templateLink:
      "https://affiliates.gohighlevel.com/?fp_ref=gcooke&funnel_share=6727aacfdbe65ce4bdda7b65",
  },
  {
    number: 3,
    previewLink: "https://app.gohighlevel.com/v2/preview/jyqLm50cw6Nrv4vLGQOg",
    templateLink:
      "https://affiliates.gohighlevel.com/?fp_ref=gcooke&funnel_share=6784e1ba53d53f215c9b905c",
  },
  {
    number: 4,
    previewLink: "https://app.gohighlevel.com/v2/preview/FNYRE9NPUDGJXjKj2gNR",
    templateLink:
      "https://affiliates.gohighlevel.com/?fp_ref=gcooke&funnel_share=69dbbceab82d8fa8ab7c2d6a",
  },
  {
    number: 5,
    previewLink: "https://app.gohighlevel.com/v2/preview/Lr8fwWraMM2kUCshUxXw",
    templateLink:
      "https://affiliates.gohighlevel.com/?fp_ref=gcooke&funnel_share=68149a58443a572c275b048d",
  },
  {
    number: 6,
    previewLink: "https://app.gohighlevel.com/v2/preview/I3wVfD378EvN1waE8cba",
    templateLink:
      "https://affiliates.gohighlevel.com/?fp_ref=gcooke&funnel_share=69dc97c42881c8212031d606",
  },
  {
    number: 7,
    previewLink: "https://app.gohighlevel.com/v2/preview/EnP5lKzrPIAk3JziSenc",
    templateLink:
      "https://affiliates.gohighlevel.com/?fp_ref=gcooke&funnel_share=68149e2a092bc2ec0c394f27",
  },
  {
    number: 8,
    previewLink: "https://app.gohighlevel.com/v2/preview/wRUDCvqaThuySr8dMd8x",
    templateLink:
      "https://affiliates.gohighlevel.com/?fp_ref=gcooke&funnel_share=69dccfb5b54b44b849da2c9e",
  },
  {
    number: 9,
    previewLink: "https://app.gohighlevel.com/v2/preview/qRn7yoFHh0xCiYjvRuGl",
    templateLink:
      "https://affiliates.gohighlevel.com/?fp_ref=gcooke&funnel_share=69dcfb2f3ed1419cf4efc50c",
  },
  {
    number: 10,
    previewLink: "https://app.gohighlevel.com/v2/preview/BV7cpFlRT24JPM5txOkB",
    templateLink:
      "https://affiliates.gohighlevel.com/?fp_ref=gcooke&funnel_share=682c16d16ef4e660f635dab6",
  },
];

export default function DfyFunnelTemplates() {
  return (
    <DfySubPageShell
      title="10 Sales Funnel Templates"
      description="Quiz funnels and sales flows you can clone, fill in, and launch."
    >
      <div className="bg-gradient-to-br from-[#1a1a1a] to-[#0f0f0f] border border-[#C9A44C]/25 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-6 mb-8">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-[#C9A44C] font-bold uppercase tracking-[0.22em] mb-3">
            Recommended Builder
          </p>
          <h3
            className="text-[22px] md:text-[26px] font-bold uppercase tracking-[0.01em] text-white leading-[1.1] mb-3"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Build your sales funnels on Go High Level
          </h3>
          <p className="text-[13.5px] text-white/65 leading-[1.65]">
            You need a GoHighLevel account for this - get a 14-day free
            trial here. We build every one of our sales funnels on Go
            High Level - it's the single tool we use for landing pages,
            automations, email and SMS follow-up. Use our partner link
            to start your trial (or sign in if you already have one),
            then import any template below.
          </p>
        </div>
        <a
          href={GHL_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 inline-flex items-center justify-center gap-2 bg-[#C9A44C] text-black font-bold text-[12px] uppercase tracking-[0.14em] px-6 py-3 rounded-lg hover:bg-[#dfb960] transition-colors"
        >
          Open Go High Level
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
        {FUNNEL_TEMPLATES.map((t) => (
          <div
            key={t.number}
            className="bg-gradient-to-br from-[#1a1a1a] to-[#0f0f0f] border border-[#C9A44C]/25 rounded-2xl p-6 flex flex-col"
          >
            <p className="text-[10px] text-[#C9A44C] font-bold uppercase tracking-[0.22em] mb-3">
              Sales Funnel
            </p>
            <div
              className="text-[64px] md:text-[72px] font-bold uppercase tracking-[0.01em] text-white leading-none mb-2"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              {String(t.number).padStart(2, "0")}
            </div>
            <p
              className="text-[15px] font-bold uppercase tracking-[0.05em] text-white/85 mb-6"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              Template {t.number}
            </p>
            <div className="mt-auto flex flex-col gap-2.5">
              <a
                href={t.previewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 bg-white/[0.04] text-white/80 hover:text-white border border-white/[0.08] hover:border-white/[0.16] font-bold text-[12px] uppercase tracking-[0.14em] px-4 py-2.5 rounded-lg transition-colors"
              >
                Preview
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <a
                href={t.templateLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 bg-[#C9A44C] text-black hover:bg-[#dfb960] font-bold text-[12px] uppercase tracking-[0.14em] px-4 py-2.5 rounded-lg transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Import Template
              </a>
            </div>
          </div>
        ))}
      </div>
    </DfySubPageShell>
  );
}
