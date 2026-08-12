import { DfyTemplateGallery } from "@/components/dfy-template-gallery";

export default function DfyAdvertorialAdTemplates() {
  return (
    <DfyTemplateGallery
      category="advertorial_swipe"
      title="Advertorial Ad Templates"
      description="Searchable library of advertorial ad templates — filter by format, hook, subject, and visual style."
      filterLabels={{
        theme: "Format",
        awarenessStage: "Hook",
        industry: "Subject",
        theme2: "Style",
      }}
    />
  );
}
