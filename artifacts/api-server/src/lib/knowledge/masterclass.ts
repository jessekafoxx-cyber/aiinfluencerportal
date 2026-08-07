import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { FetchedDoc } from "./youtube";

interface LessonRow {
  id: number;
  title: string;
  brief: string | null;
  notes: string | null;
  slug: string | null;
  wistiaVideoId: string | null;
  phaseTitle: string | null;
  phaseSortOrder: number | null;
}

// Reads every published lesson from the course tables and returns a FetchedDoc
// per lesson, with the rich HTML notes stripped to plain text. This is the
// fastest way to get Greg's actual masterclass content into the knowledge
// base without waiting on a Wistia transcription pipeline.
//
// One doc per lesson keeps attribution clean: a chunk hit always tells you
// which phase + lesson it came from.
export async function fetchCourseLessons(max: number): Promise<FetchedDoc[]> {
  // Honor the source's maxDocuments cap so embedding cost cannot run away
  // as the catalog grows. Cap defensively at 1 to avoid a 0/-1 footgun.
  const cap = Math.max(1, max | 0);

  // Joining lessons -> course_phases. Sort by phase order then lesson sort
  // order so external IDs are stable and chunk neighborhoods are coherent.
  const result = await db.execute(sql`
    SELECT
      l.id              AS "id",
      l.title           AS "title",
      l.brief           AS "brief",
      l.notes           AS "notes",
      l.slug            AS "slug",
      l.wistia_video_id AS "wistiaVideoId",
      p.title           AS "phaseTitle",
      p.sort_order      AS "phaseSortOrder"
    FROM lessons l
    LEFT JOIN course_phases p ON p.id = l.phase_id
    WHERE l.is_published = true
    ORDER BY p.sort_order, l.sort_order, l.id
    LIMIT ${cap}
  `);
  const rows = ((result as any).rows ?? result) as LessonRow[];

  const docs: FetchedDoc[] = [];
  for (const row of rows) {
    const notesText = htmlToPlainText(row.notes || "");
    const briefText = htmlToPlainText(row.brief || "");
    // Title block at top so the embedding has lexical anchor on lesson name.
    const phasePrefix = row.phaseTitle ? `Phase: ${row.phaseTitle}\n` : "";
    const titleBlock = `${phasePrefix}Lesson: ${row.title}\n`;
    const briefBlock = briefText ? `\nBrief:\n${briefText}\n` : "";
    const notesBlock = notesText ? `\nLesson notes:\n${notesText}\n` : "";
    const wistiaNote = row.wistiaVideoId
      ? `\n(Video reference: wistia ${row.wistiaVideoId})`
      : "";
    const rawText = `${titleBlock}${briefBlock}${notesBlock}${wistiaNote}`.trim();

    // Skip empty lessons (no notes, no brief). Pure video without text gives
    // us nothing to embed yet — we will add transcripts in a later pass.
    if (rawText.length < 80) continue;

    docs.push({
      externalId: `lesson:${row.id}`,
      title: `${row.phaseTitle ? `${row.phaseTitle} / ` : ""}${row.title}`,
      url: row.slug ? `/portal/lessons/${row.slug}` : `/portal/lessons/${row.id}`,
      rawText,
      publishedAt: undefined,
      metadata: {
        lessonId: row.id,
        phaseTitle: row.phaseTitle,
        wistiaVideoId: row.wistiaVideoId,
        slug: row.slug,
      },
    });
  }
  return docs;
}

// Lightweight HTML to plain text. Course notes are stored as TipTap output
// (lots of <p>, <h2>, <ul><li>, <strong>, <a>). We do not need a real parser
// here, just block-level structure preserved as line breaks plus tag stripping.
function htmlToPlainText(html: string): string {
  if (!html) return "";
  let s = html;

  // Decode the most common entities first so they survive tag stripping.
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"');

  // Drop scripts and styles entirely.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Convert block-level closers to newlines so paragraphs do not run together.
  s = s.replace(/<\/(p|h[1-6]|li|tr|div|blockquote)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/?(ul|ol|table|tbody|thead)[^>]*>/gi, "\n");
  // Bullet markers for list items.
  s = s.replace(/<li[^>]*>/gi, "- ");

  // Strip every remaining tag.
  s = s.replace(/<[^>]+>/g, "");

  // Collapse whitespace.
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");

  return s.trim();
}
