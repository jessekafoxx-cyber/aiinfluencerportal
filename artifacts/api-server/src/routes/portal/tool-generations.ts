import type { RequestHandler, Router } from "express";
import { db, toolGenerationsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

export interface ToolGenerationsDeps {
  requireAuth: RequestHandler;
  requireActive: RequestHandler;
}

// Allowlist of tool slugs that may be queried. Keeps random clients from
// using this as a general jsonb dump and makes the surface explicit.
const ALLOWED_TOOL_SLUGS = new Set([
  "carousel",
  "prompt-generator",
  "bio-generator",
  "domain-name-generator",
  "image-prompt-generator",
]);

/**
 * Generic per-tool generation history endpoints. Backed by the
 * tool_generations table. Each lightweight portal AI tool writes a row via
 * saveToolGeneration() after a successful response; the frontend lists,
 * restores, and deletes through these routes.
 *
 *   GET    /portal/tool-generations?tool=<slug>&limit=20
 *   GET    /portal/tool-generations/:id
 *   DELETE /portal/tool-generations/:id
 *
 * Mounted from routes/portal.ts.
 */
export function registerToolGenerationsRoutes(
  portalRouter: Router,
  { requireAuth, requireActive }: ToolGenerationsDeps,
): void {
  portalRouter.get("/portal/tool-generations", requireAuth, requireActive, async (req: any, res) => {
    try {
      const userId = req.portalUser.id;
      const toolSlug = String(req.query?.tool || "").trim();
      if (!toolSlug || !ALLOWED_TOOL_SLUGS.has(toolSlug)) {
        res.status(400).json({ error: "Unsupported tool slug" });
        return;
      }
      const rawLimit = Number(req.query?.limit ?? 20);
      const limit = Math.max(1, Math.min(50, Number.isFinite(rawLimit) ? rawLimit : 20));

      const rows = await db
        .select({
          id: toolGenerationsTable.id,
          toolSlug: toolGenerationsTable.toolSlug,
          label: toolGenerationsTable.label,
          createdAt: toolGenerationsTable.createdAt,
        })
        .from(toolGenerationsTable)
        .where(
          and(
            eq(toolGenerationsTable.portalUserId, userId),
            eq(toolGenerationsTable.toolSlug, toolSlug),
          ),
        )
        .orderBy(desc(toolGenerationsTable.createdAt))
        .limit(limit);

      res.json({ items: rows });
    } catch (err: any) {
      req.log?.error?.({ err: err?.message }, "[tool-generations] list failed");
      res.status(500).json({ error: err?.message || "Could not load history" });
    }
  });

  portalRouter.get("/portal/tool-generations/:id", requireAuth, requireActive, async (req: any, res) => {
    try {
      const userId = req.portalUser.id;
      const id = Number(req.params?.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const [row] = await db
        .select()
        .from(toolGenerationsTable)
        .where(
          and(
            eq(toolGenerationsTable.id, id),
            eq(toolGenerationsTable.portalUserId, userId),
          ),
        )
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ item: row });
    } catch (err: any) {
      req.log?.error?.({ err: err?.message }, "[tool-generations] get failed");
      res.status(500).json({ error: err?.message || "Could not load generation" });
    }
  });

  portalRouter.delete("/portal/tool-generations/:id", requireAuth, requireActive, async (req: any, res) => {
    try {
      const userId = req.portalUser.id;
      const id = Number(req.params?.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const deleted = await db
        .delete(toolGenerationsTable)
        .where(
          and(
            eq(toolGenerationsTable.id, id),
            eq(toolGenerationsTable.portalUserId, userId),
          ),
        )
        .returning({ id: toolGenerationsTable.id });
      if (deleted.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err: any) {
      req.log?.error?.({ err: err?.message }, "[tool-generations] delete failed");
      res.status(500).json({ error: err?.message || "Could not delete generation" });
    }
  });
}
