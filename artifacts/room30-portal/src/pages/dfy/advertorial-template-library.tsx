import { useState } from "react";
import { Download, Eye, Copy, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  ADVERTORIAL_TEMPLATES,
  ADVERTORIAL_STYLES,
  type AdvertorialTemplate,
} from "./advertorial-templates-data";

function slugFilename(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Ready-to-use HTML advertorial template library, grouped by style. Shared by
// the DFY Pack advertorial page and the Platinum Club "Templates" tab so both
// list the templates identically.
export function AdvertorialTemplateLibrary() {
  return (
    <>
      {ADVERTORIAL_STYLES.map((style) => {
        const items = ADVERTORIAL_TEMPLATES.filter((t) => t.style === style);
        if (items.length === 0) return null;
        return (
          <section key={style} className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <h3 className="text-[14px] font-bold uppercase tracking-[0.14em] text-white/85">
                {style}
              </h3>
              <span className="text-[11px] font-semibold text-white/35">
                {items.length} templates
              </span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-2 gap-5">
              {items.map((t) => (
                <HtmlTemplateCard key={t.id} template={t} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

export function HtmlTemplateCard({ template }: { template: AdvertorialTemplate }) {
  const [copied, setCopied] = useState(false);

  const preview = () => {
    const blob = new Blob([template.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(template.html);
      setCopied(true);
      toast({ title: "HTML copied", description: `${template.name} copied to clipboard.` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Use Download instead.", variant: "destructive" });
    }
  };

  const download = () => {
    const blob = new Blob([template.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `advertorial-${String(template.number).padStart(2, "0")}-${slugFilename(template.name)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl overflow-hidden hover:border-white/[0.14] transition-colors flex flex-col">
      <div className="relative bg-gradient-to-br from-[#1a1a1a] to-[#0a0a0a] p-4 pb-2">
        <div className="rounded-t-md overflow-hidden border border-white/[0.06] bg-[#0a0a0a]">
          <div className="bg-[#161616] px-2.5 py-1.5 flex items-center gap-1.5 border-b border-white/[0.06]">
            <span className="w-1.5 h-1.5 rounded-full bg-white/15" />
            <span className="w-1.5 h-1.5 rounded-full bg-white/15" />
            <span className="w-1.5 h-1.5 rounded-full bg-white/15" />
          </div>
          <button
            onClick={preview}
            className="block w-full aspect-[16/10] bg-white overflow-hidden relative group cursor-pointer"
            aria-label={`Preview ${template.name}`}
          >
            <iframe
              title={template.name}
              srcDoc={template.html}
              tabIndex={-1}
              scrolling="no"
              sandbox=""
              className="origin-top-left pointer-events-none"
              style={{ width: "250%", height: "250%", transform: "scale(0.4)", border: "0" }}
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
              <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1.5 bg-white text-black text-[11px] font-bold uppercase tracking-[0.12em] px-3 py-1.5 rounded">
                <Eye className="w-3.5 h-3.5" /> Preview
              </span>
            </span>
          </button>
        </div>
        <div className="h-1.5 mx-auto bg-white/10 rounded-b-md" style={{ width: "70%" }} />
      </div>

      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex w-fit items-center text-[10px] font-bold uppercase tracking-[0.18em] text-[#C9A44C] border border-[#C9A44C]/35 bg-[#C9A44C]/[0.08] px-2 py-0.5 rounded">
            Template #{String(template.number).padStart(2, "0")}
          </span>
          <span className="inline-flex w-fit items-center text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45 border border-white/[0.1] px-2 py-0.5 rounded">
            {template.theme}
          </span>
        </div>
        <h4 className="text-[15px] font-bold text-white leading-[1.25] mb-2">{template.name}</h4>
        <p className="text-[12.5px] text-white/55 leading-[1.6] mb-4">{template.description}</p>
        <div className="mt-auto flex items-center gap-2">
          <button
            onClick={preview}
            className="flex-1 inline-flex items-center justify-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.10] text-white text-[11.5px] font-bold uppercase tracking-[0.12em] px-3 py-2.5 rounded-lg border border-white/[0.08]"
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </button>
          <button
            onClick={copy}
            className="flex-1 inline-flex items-center justify-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.10] text-white text-[11.5px] font-bold uppercase tracking-[0.12em] px-3 py-2.5 rounded-lg border border-white/[0.08]"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={download}
            className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#C9A44C] hover:bg-[#dfb960] text-black text-[11.5px] font-bold uppercase tracking-[0.12em] px-3 py-2.5 rounded-lg"
          >
            <Download className="w-3.5 h-3.5" />
            HTML
          </button>
        </div>
      </div>
    </div>
  );
}
