import { db, toolGenerationsTable } from "@workspace/db";
import { logger } from "./logger";

// Generic save helper for the lightweight portal AI tools that didn't have
// their own history table. Called fire-and-forget from each tool's
// generation route after a successful response so the user's history is
// always recorded without ever blocking the HTTP reply. Tools with their
// own bespoke table (script-writer, os-tool, greg-ai, ai-influencer, etc)
// continue to use their own writer - this is only for the previously
// ephemeral ones.
//
// Keep `label` short and human-readable (the user's hook, offer, subject -
// whatever reads well in a 1-line history row). `input` and `output` are
// the full payloads needed to re-render the result UI later.
export async function saveToolGeneration(opts: {
  portalUserId: number;
  toolSlug: string;
  label?: string | null;
  input: unknown;
  output: unknown;
}): Promise<void> {
  try {
    await db.insert(toolGenerationsTable).values({
      portalUserId: opts.portalUserId,
      toolSlug: opts.toolSlug,
      label: opts.label ? String(opts.label).slice(0, 280) : null,
      input: (opts.input ?? {}) as object,
      output: (opts.output ?? {}) as object,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), toolSlug: opts.toolSlug, portalUserId: opts.portalUserId },
      "[tool-generations] save failed (non-fatal)",
    );
  }
}
