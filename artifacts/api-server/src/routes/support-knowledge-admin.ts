import { Router } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { db, supportKnowledgeDocsTable } from "@workspace/db";
import { requireSuperAdmin } from "../middlewares/requireAuth";
import {
  ingestSupportKnowledge,
  isWistiaConfigured,
} from "../support-bot/knowledge-ingest";
import {
  addManualSupportDoc,
  startYoutubeIngest,
  getYoutubeJobStatus,
} from "../support-bot/custom-knowledge";
import { runSupportBotDailySummary } from "../support-bot/daily-summary";

// Admin management for Steph's (support bot) knowledge base:
// masterclass sync status + resync, manual docs, YouTube imports.
// Mounted under /api via routes/index.ts; all endpoints admin-gated.

const router = Router();

const CUSTOM_SOURCE_TYPES = ["manual", "youtube"];

let masterclassResyncRunning = false;

router.get(
  "/portal/admin/support-knowledge/overview",
  requireSuperAdmin,
  async (req, res) => {
    try {
      const docs = await db
        .select({
          id: supportKnowledgeDocsTable.id,
          sourceType: supportKnowledgeDocsTable.sourceType,
          title: supportKnowledgeDocsTable.lessonTitle,
          group: supportKnowledgeDocsTable.phaseTitle,
          sourceUrl: supportKnowledgeDocsTable.sourceUrl,
          chunkCount: supportKnowledgeDocsTable.chunkCount,
          updatedAt: supportKnowledgeDocsTable.updatedAt,
        })
        .from(supportKnowledgeDocsTable)
        .orderBy(desc(supportKnowledgeDocsTable.updatedAt));

      const stats = {
        totalDocs: docs.length,
        totalChunks: docs.reduce((s, d) => s + (d.chunkCount || 0), 0),
        lessonNotes: docs.filter((d) => d.sourceType === "lesson_notes").length,
        lessonTranscripts: docs.filter(
          (d) => d.sourceType === "lesson_transcript",
        ).length,
        manualDocs: docs.filter((d) => d.sourceType === "manual").length,
        youtubeDocs: docs.filter((d) => d.sourceType === "youtube").length,
        wistiaDocs: docs.filter((d) => d.sourceType === "wistia").length,
      };

      res.json({
        stats,
        docs,
        wistiaConfigured: isWistiaConfigured(),
        masterclassResyncRunning,
        youtubeJob: getYoutubeJobStatus(),
      });
    } catch (err) {
      req.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[support-knowledge-admin] overview failed",
      );
      res.status(500).json({ error: "Failed to load support knowledge" });
    }
  },
);

router.post(
  "/portal/admin/support-knowledge/docs",
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { title, content } = req.body ?? {};
      if (typeof title !== "string" || typeof content !== "string") {
        res.status(400).json({ error: "title and content are required" });
        return;
      }
      const result = await addManualSupportDoc({ title, content });
      res.json({ ok: true, slug: result.slug });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add doc";
      res.status(400).json({ error: message });
    }
  },
);

router.post(
  "/portal/admin/support-knowledge/youtube",
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { url, maxVideos } = req.body ?? {};
      if (typeof url !== "string" || !url.trim()) {
        res.status(400).json({ error: "url is required" });
        return;
      }
      startYoutubeIngest(url.trim(), Number(maxVideos) || 25);
      res.json({ ok: true, job: getYoutubeJobStatus() });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start import";
      res.status(400).json({ error: message });
    }
  },
);

router.delete(
  "/portal/admin/support-knowledge/docs/:id",
  requireSuperAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "Invalid doc id" });
        return;
      }
      const [doc] = await db
        .select()
        .from(supportKnowledgeDocsTable)
        .where(eq(supportKnowledgeDocsTable.id, id))
        .limit(1);
      if (!doc) {
        res.status(404).json({ error: "Doc not found" });
        return;
      }
      if (!CUSTOM_SOURCE_TYPES.includes(doc.sourceType)) {
        res.status(400).json({
          error:
            "Masterclass docs are managed automatically - unpublish the lesson to remove it from Steph's knowledge",
        });
        return;
      }
      // Chunks cascade via FK.
      await db
        .delete(supportKnowledgeDocsTable)
        .where(eq(supportKnowledgeDocsTable.id, id));
      res.json({ ok: true });
    } catch (err) {
      req.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[support-knowledge-admin] delete failed",
      );
      res.status(500).json({ error: "Failed to delete doc" });
    }
  },
);

router.post(
  "/portal/admin/support-knowledge/resync",
  requireSuperAdmin,
  async (req, res) => {
    if (masterclassResyncRunning) {
      res.status(409).json({ error: "A masterclass sync is already running" });
      return;
    }
    masterclassResyncRunning = true;
    void (async () => {
      try {
        const summary = await ingestSupportKnowledge();
        req.log.info({ summary }, "[support-knowledge-admin] resync complete");
      } catch (err) {
        req.log.error(
          { err: err instanceof Error ? err.message : String(err) },
          "[support-knowledge-admin] resync failed",
        );
      } finally {
        masterclassResyncRunning = false;
      }
    })();
    res.json({ ok: true, started: true });
  },
);

// On-demand run of the daily Steph Slack summary (same code path as the
// worker's scheduled 24h digest). Returns the summary text so admins can
// preview it in the response even if the Slack webhook is not configured.
router.post(
  "/portal/admin/support-knowledge/daily-summary/run",
  requireSuperAdmin,
  async (req, res) => {
    try {
      const result = await runSupportBotDailySummary();
      res.json({
        ok: true,
        posted: result.posted,
        aiSectionOk: result.aiSectionOk,
        stats: result.stats,
        text: result.text,
      });
    } catch (err) {
      req.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[support-knowledge-admin] daily summary run failed",
      );
      res.status(500).json({ error: "Failed to run daily summary" });
    }
  },
);

export default router;
