import { createHash } from "node:crypto";
import type { FetchedDoc } from "./youtube";

/**
 * Treat the source's manualContent as a single document. We use a content-hash
 * external ID so editing the text replaces the chunks instead of appending.
 */
export function fetchManual(name: string, manualContent: string): FetchedDoc[] {
  const text = (manualContent || "").trim();
  if (text.length < 40) return [];
  const externalId = createHash("sha256").update(text).digest("hex").slice(0, 32);
  return [
    {
      externalId,
      title: `${name} (manual notes)`,
      url: "",
      rawText: text,
      publishedAt: new Date(),
      metadata: { kind: "manual_text" },
    },
  ];
}
