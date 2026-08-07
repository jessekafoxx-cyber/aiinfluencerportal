import { createHash } from "crypto";
import { eq, and, notInArray, inArray } from "drizzle-orm";
import {
  db,
  lessonsTable,
  coursePhasesTable,
  supportKnowledgeDocsTable,
  supportKnowledgeChunksTable,
} from "@workspace/db";
import { chunkText, embedBatch } from "../lib/knowledge/embeddings";
import { logger } from "../lib/logger";

// Builds Steph's masterclass knowledge store from two sources per lesson:
//  - 'lesson_notes': title + brief + AI lesson notes (always available)
//  - 'lesson_transcript': Wistia video captions (requires WISTIA_API_KEY)
// Hash-guarded so unchanged lessons cost nothing on re-runs.

const WISTIA_API_BASE = "https://api.wistia.com/v1";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Wistia captions come back as SRT-ish text. Strip cue indexes and
// timestamp lines, join the remaining caption lines into prose.
export function srtToPlainText(srt: string): string {
  const lines = srt.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^\d+$/.test(t)) continue; // cue index
    if (/-->/.test(t)) continue; // timestamp line
    if (/^WEBVTT/i.test(t)) continue;
    out.push(t);
  }
  // De-dupe consecutive identical caption lines (common in auto captions).
  const deduped: string[] = [];
  for (const l of out) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== l) {
      deduped.push(l);
    }
  }
  return deduped.join(" ").replace(/\s+/g, " ").trim();
}

export function isWistiaConfigured(): boolean {
  return Boolean(process.env.WISTIA_API_KEY);
}

async function fetchWistiaTranscript(
  wistiaVideoId: string,
): Promise<string | null> {
  const key = process.env.WISTIA_API_KEY;
  if (!key) return null;
  const res = await fetch(
    `${WISTIA_API_BASE}/medias/${encodeURIComponent(wistiaVideoId)}/captions.json`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`wistia captions ${wistiaVideoId}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as Array<{
    language?: string;
    english_name?: string;
    text?: string;
  }>;
  if (!Array.isArray(data) || data.length === 0) return null;
  const english =
    data.find((c) => (c.english_name ?? "").toLowerCase() === "english") ??
    data.find((c) => (c.language ?? "").toLowerCase().startsWith("en")) ??
    data[0];
  const text = english?.text ?? "";
  if (!text.trim()) return null;
  const plain = srtToPlainText(text);
  return plain.length >= 100 ? plain : null;
}

export type SourceDoc = {
  // 'lesson_notes' | 'lesson_transcript' (masterclass, scheduler-managed)
  // 'manual' | 'youtube' (admin-added custom knowledge)
  sourceType: string;
  lessonSlug: string;
  lessonTitle: string;
  phaseTitle: string;
  sourceUrl?: string | null;
  body: string;
};

export async function upsertSupportDoc(
  doc: SourceDoc,
): Promise<"skipped" | "ingested"> {
  const hash = sha256(doc.body);
  const [existing] = await db
    .select()
    .from(supportKnowledgeDocsTable)
    .where(
      and(
        eq(supportKnowledgeDocsTable.sourceType, doc.sourceType),
        eq(supportKnowledgeDocsTable.lessonSlug, doc.lessonSlug),
      ),
    )
    .limit(1);
  if (existing && existing.contentHash === hash && existing.chunkCount > 0) {
    return "skipped";
  }

  const chunks = chunkText(doc.body);
  if (chunks.length === 0) return "skipped";
  const embeddings = await embedBatch(chunks);

  let docId: number;
  if (existing) {
    docId = existing.id;
    await db
      .update(supportKnowledgeDocsTable)
      .set({
        lessonTitle: doc.lessonTitle,
        phaseTitle: doc.phaseTitle,
        sourceUrl: doc.sourceUrl ?? existing.sourceUrl,
        contentHash: hash,
        chunkCount: chunks.length,
        updatedAt: new Date(),
      })
      .where(eq(supportKnowledgeDocsTable.id, docId));
    await db
      .delete(supportKnowledgeChunksTable)
      .where(eq(supportKnowledgeChunksTable.docId, docId));
  } else {
    const [created] = await db
      .insert(supportKnowledgeDocsTable)
      .values({
        sourceType: doc.sourceType,
        lessonSlug: doc.lessonSlug,
        lessonTitle: doc.lessonTitle,
        phaseTitle: doc.phaseTitle,
        sourceUrl: doc.sourceUrl ?? null,
        contentHash: hash,
        chunkCount: chunks.length,
      })
      .returning();
    if (!created) throw new Error("failed to insert support knowledge doc");
    docId = created.id;
  }

  await db.insert(supportKnowledgeChunksTable).values(
    chunks.map((content, i) => ({
      docId,
      chunkIndex: i,
      content,
      embedding: embeddings[i] ?? null,
    })),
  );
  return "ingested";
}

export interface IngestSummary {
  lessons: number;
  notesIngested: number;
  notesSkipped: number;
  transcriptsIngested: number;
  transcriptsSkipped: number;
  transcriptsMissing: number;
  transcriptErrors: number;
  wistiaConfigured: boolean;
  prunedDocs: number;
  wistiaVideosFound: number;
  wistiaIngested: number;
  wistiaSkipped: number;
  wistiaMissing: number;
  wistiaErrors: number;
  wistiaPruned: number;
}

// Extra Wistia folders (projects) + individual videos that Steph should
// learn from, beyond the course lessons. Scanned on every scheduler run
// (every 6h) so newly uploaded videos are picked up within the week.
const WISTIA_EXTRA_FOLDERS = ["i0sbnf4a41", "1vshjeymfr", "qw8c3fk3qk"];
const WISTIA_EXTRA_MEDIAS = ["xn2954lrz1"];

interface WistiaMediaRef {
  hashedId: string;
  name: string;
  folderName: string;
}

async function wistiaGet<T>(path: string): Promise<T> {
  const key = process.env.WISTIA_API_KEY;
  if (!key) throw new Error("WISTIA_API_KEY not set");
  const res = await fetch(`${WISTIA_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`wistia ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function listWistiaExtraVideos(): Promise<WistiaMediaRef[]> {
  const out: WistiaMediaRef[] = [];
  const seen = new Set<string>();
  for (const folderId of WISTIA_EXTRA_FOLDERS) {
    let folderName = "Wistia Videos";
    try {
      const project = await wistiaGet<{ name?: string }>(
        `/projects/${encodeURIComponent(folderId)}.json`,
      );
      if (project.name?.trim()) folderName = project.name.trim();
    } catch {
      // Non-fatal: keep generic folder name.
    }
    for (let page = 1; page <= 10; page++) {
      const medias = await wistiaGet<
        Array<{ hashed_id?: string; name?: string; type?: string }>
      >(
        `/medias.json?project_id=${encodeURIComponent(folderId)}&per_page=100&page=${page}`,
      );
      if (!Array.isArray(medias) || medias.length === 0) break;
      for (const m of medias) {
        const id = m.hashed_id?.trim();
        if (!id || seen.has(id)) continue;
        if (m.type && m.type !== "Video") continue;
        seen.add(id);
        out.push({
          hashedId: id,
          name: m.name?.trim() || id,
          folderName,
        });
      }
      if (medias.length < 100) break;
    }
  }
  for (const mediaId of WISTIA_EXTRA_MEDIAS) {
    if (seen.has(mediaId)) continue;
    const media = await wistiaGet<{
      hashed_id?: string;
      name?: string;
      project?: { name?: string };
    }>(`/medias/${encodeURIComponent(mediaId)}.json`);
    const id = media.hashed_id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      hashedId: id,
      name: media.name?.trim() || id,
      folderName: media.project?.name?.trim() || "Wistia Videos",
    });
  }
  return out;
}

export async function ingestSupportKnowledge(): Promise<IngestSummary> {
  const rows = await db
    .select({
      slug: lessonsTable.slug,
      title: lessonsTable.title,
      brief: lessonsTable.brief,
      notes: lessonsTable.notes,
      wistiaVideoId: lessonsTable.wistiaVideoId,
      isPublished: lessonsTable.isPublished,
      phaseTitle: coursePhasesTable.title,
    })
    .from(lessonsTable)
    .innerJoin(
      coursePhasesTable,
      eq(lessonsTable.phaseId, coursePhasesTable.id),
    )
    .where(eq(lessonsTable.isPublished, true));

  const summary: IngestSummary = {
    lessons: rows.length,
    notesIngested: 0,
    notesSkipped: 0,
    transcriptsIngested: 0,
    transcriptsSkipped: 0,
    transcriptsMissing: 0,
    transcriptErrors: 0,
    wistiaConfigured: isWistiaConfigured(),
    prunedDocs: 0,
    wistiaVideosFound: 0,
    wistiaIngested: 0,
    wistiaSkipped: 0,
    wistiaMissing: 0,
    wistiaErrors: 0,
    wistiaPruned: 0,
  };

  const liveSlugs = rows.map((r) => r.slug);

  for (const row of rows) {
    const parts: string[] = [
      `Lesson: ${row.title}`,
      `Phase: ${row.phaseTitle}`,
    ];
    if (row.brief?.trim()) parts.push(`Summary: ${stripHtml(row.brief)}`);
    if (row.notes?.trim()) parts.push(stripHtml(row.notes));
    const body = parts.join("\n\n");
    if (body.length > 80) {
      try {
        const r = await upsertSupportDoc({
          sourceType: "lesson_notes",
          lessonSlug: row.slug,
          lessonTitle: row.title,
          phaseTitle: row.phaseTitle,
          body,
        });
        if (r === "ingested") summary.notesIngested += 1;
        else summary.notesSkipped += 1;
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), lesson: row.slug },
          "[support-knowledge] notes ingest failed",
        );
      }
    }

    const videoId = row.wistiaVideoId?.trim();
    if (!videoId || !isWistiaConfigured()) continue;
    try {
      const transcript = await fetchWistiaTranscript(videoId);
      if (!transcript) {
        summary.transcriptsMissing += 1;
        continue;
      }
      const r = await upsertSupportDoc({
        sourceType: "lesson_transcript",
        lessonSlug: row.slug,
        lessonTitle: row.title,
        phaseTitle: row.phaseTitle,
        body: `Lesson: ${row.title}\n\nPhase: ${row.phaseTitle}\n\nVideo transcript:\n\n${transcript}`,
      });
      if (r === "ingested") summary.transcriptsIngested += 1;
      else summary.transcriptsSkipped += 1;
    } catch (err) {
      summary.transcriptErrors += 1;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), lesson: row.slug },
        "[support-knowledge] transcript ingest failed",
      );
    }
  }

  // Prune MASTERCLASS docs for lessons that were deleted or unpublished.
  // Scoped to lesson_* source types only - admin-added custom docs
  // ('manual', 'youtube') are never touched by the scheduler.
  if (liveSlugs.length > 0) {
    const pruned = await db
      .delete(supportKnowledgeDocsTable)
      .where(
        and(
          inArray(supportKnowledgeDocsTable.sourceType, [
            "lesson_notes",
            "lesson_transcript",
          ]),
          notInArray(supportKnowledgeDocsTable.lessonSlug, liveSlugs),
        ),
      )
      .returning({ id: supportKnowledgeDocsTable.id });
    summary.prunedDocs = pruned.length;
  }

  // Extra Wistia folders + individual videos (Platinum Club calls, talks,
  // AI Influencer Masterclass, etc). Deduped against course lessons so a
  // video already ingested as a lesson_transcript is not stored twice.
  if (isWistiaConfigured()) {
    const lessonVideoIds = new Set(
      rows
        .map((r) => r.wistiaVideoId?.trim())
        .filter((v): v is string => Boolean(v)),
    );
    let listingFailed = false;
    let videos: WistiaMediaRef[] = [];
    try {
      videos = await listWistiaExtraVideos();
    } catch (err) {
      listingFailed = true;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[support-knowledge] wistia folder listing failed",
      );
    }

    const liveWistiaSlugs: string[] = [];
    for (const video of videos) {
      if (lessonVideoIds.has(video.hashedId)) continue;
      summary.wistiaVideosFound += 1;
      const slug = `wistia:${video.hashedId}`;
      liveWistiaSlugs.push(slug);
      try {
        const transcript = await fetchWistiaTranscript(video.hashedId);
        if (!transcript) {
          summary.wistiaMissing += 1;
          continue;
        }
        const r = await upsertSupportDoc({
          sourceType: "wistia",
          lessonSlug: slug,
          lessonTitle: video.name,
          phaseTitle: video.folderName,
          sourceUrl: `https://gregorycooke.wistia.com/medias/${video.hashedId}`,
          body: `Video: ${video.name}\n\nCollection: ${video.folderName}\n\nVideo transcript:\n\n${transcript}`,
        });
        if (r === "ingested") summary.wistiaIngested += 1;
        else summary.wistiaSkipped += 1;
      } catch (err) {
        summary.wistiaErrors += 1;
        logger.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            video: video.hashedId,
          },
          "[support-knowledge] wistia video ingest failed",
        );
      }
    }

    // Prune 'wistia' docs for videos removed from the tracked folders -
    // only when the listing itself succeeded, so an API outage never
    // wipes the store.
    if (!listingFailed) {
      const pruned = liveWistiaSlugs.length
        ? await db
            .delete(supportKnowledgeDocsTable)
            .where(
              and(
                eq(supportKnowledgeDocsTable.sourceType, "wistia"),
                notInArray(
                  supportKnowledgeDocsTable.lessonSlug,
                  liveWistiaSlugs,
                ),
              ),
            )
            .returning({ id: supportKnowledgeDocsTable.id })
        : await db
            .delete(supportKnowledgeDocsTable)
            .where(eq(supportKnowledgeDocsTable.sourceType, "wistia"))
            .returning({ id: supportKnowledgeDocsTable.id });
      summary.wistiaPruned = pruned.length;
    }
  }

  return summary;
}

// Worker-side scheduler: ingest shortly after boot, then every 6 hours.
// Hash guard means unchanged lessons are free; only new/edited notes or
// newly available transcripts cost embedding calls.
const BOOT_DELAY_MS = 2 * 60 * 1000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;
let running = false;

export function startSupportKnowledgeScheduler(): void {
  if (process.env.SUPPORT_KNOWLEDGE_INGEST_DISABLED === "1") {
    logger.info("[support-knowledge] scheduler disabled via env");
    return;
  }
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await ingestSupportKnowledge();
      logger.info({ summary }, "[support-knowledge] ingest run complete");
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[support-knowledge] ingest run failed",
      );
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), BOOT_DELAY_MS);
  setInterval(() => void run(), INTERVAL_MS);
  logger.info("[support-knowledge] scheduler started (boot +2m, every 6h)");
}
