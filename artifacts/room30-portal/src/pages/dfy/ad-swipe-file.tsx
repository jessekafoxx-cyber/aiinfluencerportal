import { DfyTemplateGallery } from "@/components/dfy-template-gallery";

export default function DfyAdSwipeFile() {
  return (
    <DfyTemplateGallery
      category="ad_swipe"
      title="Ad Swipe File"
      description="A working library of high-performing ads to study and remix - sorted for easy reference."
      banner={
        <div className="mb-5">
          <span
            className="inline-flex items-center text-[10px] font-bold uppercase tracking-[0.18em] px-2.5 py-1 rounded-full bg-[#C9A44C]/15 text-[#C9A44C] border border-[#C9A44C]/30"
            title="100+ more added every week"
          >
            100+ more added every week
          </span>
        </div>
      }
    />
  );
}
