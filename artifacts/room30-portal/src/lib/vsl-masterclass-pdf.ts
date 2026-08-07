import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  VSL_MASTERCLASS_CHAPTERS,
  type Block,
  type Chapter,
} from "@/content/vsl-masterclass";

declare module "jspdf" {
  interface jsPDF {
    lastAutoTable?: { finalY: number };
  }
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 18;
const MARGIN_TOP = 20;
const MARGIN_BOTTOM = 20;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const CONTENT_H = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM;
const FOOTER_TEXT = "VSL Masterclass";

const TOC_HEADER_H = 27;
const TOC_TITLE_LINE_H = 5;
const TOC_ROW_GAP = 4;
const TOC_TITLE_INDENT = 14;
const TOC_PAGE_NUMBER_RESERVE = 18;
const TOC_TITLE_WIDTH =
  CONTENT_W - TOC_TITLE_INDENT - TOC_PAGE_NUMBER_RESERVE;

const GOLD: RGB = [184, 144, 47];
const GOLD_LIGHT: RGB = [243, 238, 221];
const GOLD_DEEP: RGB = [110, 86, 26];
const TEXT_DARK: RGB = [26, 26, 26];
const TEXT_MUTED: RGB = [110, 110, 110];
const TEXT_FAINT: RGB = [150, 150, 150];
const BORDER: RGB = [218, 218, 218];
const CALLOUT_GOLD_BG: RGB = [251, 246, 232];
const CALLOUT_GOLD_BORDER: RGB = [201, 164, 76];
const CALLOUT_DANGER_BG: RGB = [251, 236, 236];
const CALLOUT_DANGER_BORDER: RGB = [218, 137, 137];
const CALLOUT_NEUTRAL_BG: RGB = [248, 248, 248];
const CALLOUT_NEUTRAL_BORDER: RGB = [218, 218, 218];
const TEMPLATE_BG: RGB = [251, 246, 232];
const TEMPLATE_BORDER: RGB = [201, 164, 76];

type RGB = [number, number, number];
type FontStyle = "normal" | "bold" | "italic" | "bolditalic";
type FontFamily = "helvetica" | "times" | "courier";

type Cursor = {
  doc: jsPDF;
  y: number;
};

function newCursor(doc: jsPDF): Cursor {
  return { doc, y: MARGIN_TOP };
}

function ensureSpace(c: Cursor, needed: number) {
  if (c.y + needed > PAGE_H - MARGIN_BOTTOM) {
    c.doc.addPage();
    c.y = MARGIN_TOP;
  }
}

function setText(
  c: Cursor,
  size: number,
  style: FontStyle,
  color: RGB = TEXT_DARK,
  font: FontFamily = "helvetica",
) {
  c.doc.setFont(font, style);
  c.doc.setFontSize(size);
  c.doc.setTextColor(color[0], color[1], color[2]);
}

function writeWrapped(
  c: Cursor,
  text: string,
  opts: {
    size?: number;
    style?: FontStyle;
    color?: RGB;
    font?: FontFamily;
    indent?: number;
    width?: number;
    lineHeight?: number;
    bottomGap?: number;
  } = {},
) {
  const size = opts.size ?? 10.5;
  const style = opts.style ?? "normal";
  const color = opts.color ?? TEXT_DARK;
  const font = opts.font ?? "helvetica";
  const indent = opts.indent ?? 0;
  const width = opts.width ?? CONTENT_W - indent;
  const lineHeight = opts.lineHeight ?? size * 0.42;
  const bottomGap = opts.bottomGap ?? lineHeight * 0.45;

  setText(c, size, style, color, font);
  const lines = c.doc.splitTextToSize(text, width) as string[];
  for (const line of lines) {
    ensureSpace(c, lineHeight);
    c.doc.text(line, MARGIN_X + indent, c.y + lineHeight * 0.78);
    c.y += lineHeight;
  }
  c.y += bottomGap;
}

function drawRule(doc: jsPDF, y: number, color: RGB = BORDER) {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
}

function measureWrapped(
  c: Cursor,
  text: string,
  opts: {
    size?: number;
    style?: FontStyle;
    font?: FontFamily;
    width?: number;
    lineHeight?: number;
  } = {},
): { lines: string[]; height: number; lineHeight: number } {
  const size = opts.size ?? 10.5;
  const style = opts.style ?? "normal";
  const font = opts.font ?? "helvetica";
  const width = opts.width ?? CONTENT_W;
  const lineHeight = opts.lineHeight ?? size * 0.42;
  c.doc.setFont(font, style);
  c.doc.setFontSize(size);
  const lines = c.doc.splitTextToSize(text, width) as string[];
  return { lines, height: lines.length * lineHeight, lineHeight };
}

function renderCover(doc: jsPDF, chapterCount: number) {
  doc.setFillColor(17, 17, 17);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(GOLD[0], GOLD[1], GOLD[2]);
  doc.text("PROMPT & BUILD", MARGIN_X, 70);

  doc.setFontSize(44);
  doc.setTextColor(255, 255, 255);
  doc.text("VSL", MARGIN_X, 100);
  doc.text("MASTERCLASS", MARGIN_X, 122);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(220, 220, 220);
  const sub = doc.splitTextToSize(
    "The full long-form playbook behind every VSL we ship — rebuilt around the Low Ticket Ascension model. Frameworks, banks, line-by-line breakdowns, and the editing SOP.",
    CONTENT_W - 30,
  ) as string[];
  let yy = 145;
  for (const line of sub) {
    doc.text(line, MARGIN_X, yy);
    yy += 6;
  }

  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, PAGE_H - 50, MARGIN_X + 60, PAGE_H - 50);
  doc.setFontSize(9.5);
  doc.setTextColor(180, 180, 180);
  doc.text(`${chapterCount} chapters`, MARGIN_X, PAGE_H - 42);
  doc.text(
    "Premium add-on · VSL Vault order bump",
    MARGIN_X,
    PAGE_H - 36,
  );
}

type TocEntry = { number: string; title: string; page: number };

type TocRow = {
  number: string;
  titleLines: string[];
  rowHeight: number;
};

type TocLayout = {
  rows: TocRow[];
  pageBreaks: number[]; // row indices where a new page starts
  pageCount: number;
};

function planTocLayout(doc: jsPDF, chapters: Chapter[]): TocLayout {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  const rows: TocRow[] = chapters.map((ch) => {
    const titleLines = doc.splitTextToSize(
      ch.title,
      TOC_TITLE_WIDTH,
    ) as string[];
    const rowHeight =
      Math.max(7, titleLines.length * TOC_TITLE_LINE_H + 2) + TOC_ROW_GAP;
    return { number: ch.number, titleLines, rowHeight };
  });

  const pageBreaks: number[] = [0];
  let yUsed = TOC_HEADER_H;
  for (let i = 0; i < rows.length; i++) {
    if (yUsed + rows[i].rowHeight > CONTENT_H) {
      pageBreaks.push(i);
      yUsed = 0;
    }
    yUsed += rows[i].rowHeight;
  }

  return { rows, pageBreaks, pageCount: pageBreaks.length };
}

function paintTocPages(
  doc: jsPDF,
  firstTocPage: number,
  layout: TocLayout,
  chapters: Chapter[],
  toc: TocEntry[] | null,
) {
  for (let pageIdx = 0; pageIdx < layout.pageCount; pageIdx++) {
    doc.setPage(firstTocPage + pageIdx);
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, PAGE_H, "F");

    let y = MARGIN_TOP;
    if (pageIdx === 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(GOLD[0], GOLD[1], GOLD[2]);
      doc.text("CONTENTS", MARGIN_X, y + 6);
      y += 10;
      doc.setFontSize(24);
      doc.setTextColor(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
      doc.text("Chapter Index", MARGIN_X, y + 8);
      y += 14;
      drawRule(doc, y);
      y += 3;
    }

    const startRow = layout.pageBreaks[pageIdx];
    const endRow =
      pageIdx + 1 < layout.pageCount
        ? layout.pageBreaks[pageIdx + 1]
        : layout.rows.length;

    for (let i = startRow; i < endRow; i++) {
      const row = layout.rows[i];
      const ch = chapters[i];
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(GOLD[0], GOLD[1], GOLD[2]);
      doc.text(row.number, MARGIN_X, y + 4.5);
      doc.setTextColor(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
      let yy = y + 4.5;
      for (const line of row.titleLines) {
        doc.text(line, MARGIN_X + TOC_TITLE_INDENT, yy);
        yy += TOC_TITLE_LINE_H;
      }
      if (toc) {
        const entry = toc[i] ?? { page: 0, title: ch.title };
        const displayPage = String(Math.max(1, entry.page - 1));
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
        const w = doc.getTextWidth(displayPage);
        doc.text(displayPage, MARGIN_X + CONTENT_W - w, y + 4.5);
      }
      const rowEnd = y + row.rowHeight - TOC_ROW_GAP;
      drawRule(doc, rowEnd);
      y += row.rowHeight;
    }
  }
}

function renderHeading(c: Cursor, text: string, level: 2 | 3) {
  const size = level === 3 ? 11 : 13.5;
  ensureSpace(c, size * 0.6 + 6);
  c.y += level === 3 ? 2 : 4;
  writeWrapped(c, text.toUpperCase(), {
    size,
    style: "bold",
    color: TEXT_DARK,
    lineHeight: size * 0.5,
    bottomGap: 1.5,
  });
}

function renderPara(c: Cursor, text: string) {
  writeWrapped(c, text, {
    size: 10.5,
    color: TEXT_DARK,
    lineHeight: 4.7,
    bottomGap: 2,
  });
}

function renderList(c: Cursor, items: string[], ordered: boolean) {
  const indent = 7;
  for (let i = 0; i < items.length; i++) {
    const marker = ordered ? `${i + 1}.` : "•";
    const measured = measureWrapped(c, items[i], {
      size: 10.5,
      width: CONTENT_W - indent,
      lineHeight: 4.7,
    });
    ensureSpace(c, measured.height + 1);
    c.doc.setFont("helvetica", "bold");
    c.doc.setFontSize(10.5);
    c.doc.setTextColor(GOLD[0], GOLD[1], GOLD[2]);
    c.doc.text(marker, MARGIN_X, c.y + measured.lineHeight * 0.78);
    c.doc.setFont("helvetica", "normal");
    c.doc.setTextColor(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
    let yy = c.y;
    for (const line of measured.lines) {
      if (yy + measured.lineHeight > PAGE_H - MARGIN_BOTTOM) {
        c.doc.addPage();
        yy = MARGIN_TOP;
      }
      c.doc.text(line, MARGIN_X + indent, yy + measured.lineHeight * 0.78);
      yy += measured.lineHeight;
    }
    c.y = yy + 1.2;
  }
  c.y += 1.5;
}

function renderCallout(
  c: Cursor,
  block: Extract<Block, { kind: "callout" }>,
) {
  const tone = block.tone || "neutral";
  const bg =
    tone === "gold"
      ? CALLOUT_GOLD_BG
      : tone === "danger"
      ? CALLOUT_DANGER_BG
      : CALLOUT_NEUTRAL_BG;
  const border =
    tone === "gold"
      ? CALLOUT_GOLD_BORDER
      : tone === "danger"
      ? CALLOUT_DANGER_BORDER
      : CALLOUT_NEUTRAL_BORDER;
  const padX = 4;
  const padY = 3;
  const innerW = CONTENT_W - padX * 2;

  const titleH = block.title
    ? measureWrapped(c, block.title.toUpperCase(), {
        size: 8.5,
        style: "bold",
        width: innerW,
        lineHeight: 4,
      }).height
    : 0;
  const titleGap = block.title ? 1.5 : 0;
  const textM = measureWrapped(c, block.text, {
    size: 10.5,
    width: innerW,
    lineHeight: 4.7,
  });
  const totalH = padY * 2 + titleH + titleGap + textM.height;

  if (c.y + totalH > PAGE_H - MARGIN_BOTTOM) {
    c.doc.addPage();
    c.y = MARGIN_TOP;
  }

  c.doc.setFillColor(bg[0], bg[1], bg[2]);
  c.doc.setDrawColor(border[0], border[1], border[2]);
  c.doc.setLineWidth(0.3);
  c.doc.roundedRect(MARGIN_X, c.y, CONTENT_W, totalH, 1.5, 1.5, "FD");

  let innerY = c.y + padY;
  if (block.title) {
    setText(c, 8.5, "bold", border);
    c.doc.text(block.title.toUpperCase(), MARGIN_X + padX, innerY + 3);
    innerY += titleH + titleGap;
  }
  setText(c, 10.5, "normal", TEXT_DARK);
  for (const line of textM.lines) {
    c.doc.text(line, MARGIN_X + padX, innerY + textM.lineHeight * 0.78);
    innerY += textM.lineHeight;
  }
  c.y += totalH + 3;
}

function renderTable(
  c: Cursor,
  block: Extract<Block, { kind: "table" }>,
) {
  autoTable(c.doc, {
    head: [block.columns],
    body: block.rows,
    startY: c.y,
    margin: { left: MARGIN_X, right: MARGIN_X },
    theme: "grid",
    headStyles: {
      fillColor: GOLD_LIGHT,
      textColor: GOLD_DEEP,
      fontStyle: "bold",
      fontSize: 8.5,
      cellPadding: 2.5,
      halign: "left",
    },
    bodyStyles: {
      fontSize: 9.5,
      textColor: TEXT_DARK,
      cellPadding: 2.5,
      lineColor: BORDER,
      lineWidth: 0.15,
      valign: "top",
    },
    alternateRowStyles: { fillColor: [250, 248, 241] },
    styles: { font: "helvetica", overflow: "linebreak" },
  });
  c.y = (c.doc.lastAutoTable?.finalY ?? c.y) + 4;
}

function renderAnnotation(
  c: Cursor,
  block: Extract<Block, { kind: "annotation" }>,
) {
  if (block.title) {
    ensureSpace(c, 8);
    c.doc.setFillColor(GOLD_LIGHT[0], GOLD_LIGHT[1], GOLD_LIGHT[2]);
    c.doc.rect(MARGIN_X, c.y, CONTENT_W, 6, "F");
    setText(c, 8.5, "bold", GOLD_DEEP);
    c.doc.text(block.title.toUpperCase(), MARGIN_X + 3, c.y + 4);
    c.y += 6;
  }
  const head = [["VSL line", "What it's doing & why it works"]];
  const body = block.rows.map((r) => [r.line, r.note]);
  autoTable(c.doc, {
    head,
    body,
    startY: c.y,
    margin: { left: MARGIN_X, right: MARGIN_X },
    theme: "grid",
    headStyles: {
      fillColor: [248, 248, 248],
      textColor: TEXT_MUTED,
      fontStyle: "bold",
      fontSize: 8,
      cellPadding: 2.5,
      halign: "left",
    },
    bodyStyles: {
      fontSize: 9.5,
      textColor: TEXT_DARK,
      cellPadding: 3,
      lineColor: BORDER,
      lineWidth: 0.15,
      valign: "top",
    },
    columnStyles: {
      0: { fontStyle: "italic", fillColor: [250, 250, 250] },
    },
    styles: { font: "helvetica", overflow: "linebreak" },
  });
  c.y = (c.doc.lastAutoTable?.finalY ?? c.y) + 4;
}

function renderTemplate(
  c: Cursor,
  block: Extract<Block, { kind: "template" }>,
) {
  const padX = 4;
  const padY = 3;
  const innerW = CONTENT_W - padX * 2;
  const titleH = 6;
  const bodyM = measureWrapped(c, block.body, {
    size: 9.5,
    width: innerW,
    lineHeight: 4.4,
  });

  ensureSpace(c, titleH + bodyM.lineHeight + padY * 2 + 2);

  c.doc.setFillColor(GOLD_LIGHT[0], GOLD_LIGHT[1], GOLD_LIGHT[2]);
  c.doc.setDrawColor(
    TEMPLATE_BORDER[0],
    TEMPLATE_BORDER[1],
    TEMPLATE_BORDER[2],
  );
  c.doc.setLineWidth(0.3);
  c.doc.rect(MARGIN_X, c.y, CONTENT_W, titleH, "FD");
  setText(c, 8.5, "bold", GOLD_DEEP);
  c.doc.text(block.title.toUpperCase(), MARGIN_X + padX, c.y + 4);
  c.y += titleH;

  let lineIdx = 0;
  while (lineIdx < bodyM.lines.length) {
    const available = PAGE_H - MARGIN_BOTTOM - c.y - padY * 2;
    const maxLines = Math.max(1, Math.floor(available / bodyM.lineHeight));
    const segLines = bodyM.lines.slice(lineIdx, lineIdx + maxLines);
    const segH = padY * 2 + segLines.length * bodyM.lineHeight;
    const segStart = c.y;

    c.doc.setFillColor(TEMPLATE_BG[0], TEMPLATE_BG[1], TEMPLATE_BG[2]);
    c.doc.setDrawColor(
      TEMPLATE_BORDER[0],
      TEMPLATE_BORDER[1],
      TEMPLATE_BORDER[2],
    );
    c.doc.setLineWidth(0.3);
    c.doc.rect(MARGIN_X, segStart, CONTENT_W, segH, "FD");

    setText(c, 9.5, "normal", TEXT_DARK);
    let ty = segStart + padY;
    for (const line of segLines) {
      c.doc.text(line, MARGIN_X + padX, ty + bodyM.lineHeight * 0.78);
      ty += bodyM.lineHeight;
    }
    c.y = segStart + segH;
    lineIdx += segLines.length;
    if (lineIdx < bodyM.lines.length) {
      c.doc.addPage();
      c.y = MARGIN_TOP;
    }
  }
  c.y += 4;
}

function renderBlock(c: Cursor, block: Block) {
  switch (block.kind) {
    case "para":
      return renderPara(c, block.text);
    case "heading":
      return renderHeading(c, block.text, block.level || 2);
    case "list":
      return renderList(c, block.items, !!block.ordered);
    case "callout":
      return renderCallout(c, block);
    case "table":
      return renderTable(c, block);
    case "annotation":
      return renderAnnotation(c, block);
    case "template":
      return renderTemplate(c, block);
  }
}

function renderChapter(c: Cursor, chapter: Chapter): number {
  const startPage = c.doc.getCurrentPageInfo().pageNumber;

  setText(c, 9, "bold", GOLD);
  c.doc.text(`CHAPTER ${chapter.number}`, MARGIN_X, c.y + 4);
  c.y += 8;
  setText(c, 22, "bold", TEXT_DARK);
  const titleLines = c.doc.splitTextToSize(
    chapter.title.toUpperCase(),
    CONTENT_W,
  ) as string[];
  for (const line of titleLines) {
    ensureSpace(c, 9);
    c.doc.text(line, MARGIN_X, c.y + 8);
    c.y += 9;
  }
  c.y += 2;
  if (chapter.kicker) {
    writeWrapped(c, chapter.kicker, {
      size: 11,
      style: "italic",
      color: TEXT_MUTED,
      lineHeight: 5,
      bottomGap: 2,
    });
  }
  if (chapter.intro) {
    writeWrapped(c, chapter.intro, {
      size: 11,
      color: TEXT_DARK,
      lineHeight: 5,
      bottomGap: 4,
    });
  }
  for (const block of chapter.blocks) {
    renderBlock(c, block);
  }
  return startPage;
}

function stampFooters(doc: jsPDF) {
  const totalPages = doc.getNumberOfPages();
  const bodyTotal = totalPages - 1;
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(TEXT_FAINT[0], TEXT_FAINT[1], TEXT_FAINT[2]);
    const footer = `${FOOTER_TEXT}  ·  Page ${p - 1} of ${bodyTotal}`;
    const w = doc.getTextWidth(footer);
    doc.text(footer, (PAGE_W - w) / 2, PAGE_H - 8);
  }
}

export function generateVslMasterclassPdf(): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: false });
  doc.setProperties({
    title: "VSL Masterclass",
    subject: "VSL Masterclass — full long-form playbook",
    author: "Prompt & Build",
    keywords: "VSL, masterclass, copy, funnel",
    creator: "Prompt & Build Portal",
  });
  const chapters = VSL_MASTERCLASS_CHAPTERS;

  // Page 1: cover (already exists).
  renderCover(doc, chapters.length);

  // Reserve N blank pages for the TOC, computed deterministically from content.
  const tocLayout = planTocLayout(doc, chapters);
  const firstTocPage = 2;
  for (let i = 0; i < tocLayout.pageCount; i++) {
    doc.addPage();
  }

  // Render chapters starting on a new page after the reserved TOC pages.
  doc.addPage();
  const cursor = newCursor(doc);
  const toc: TocEntry[] = [];
  for (let i = 0; i < chapters.length; i++) {
    if (i > 0) {
      doc.addPage();
      cursor.y = MARGIN_TOP;
    }
    const startPage = renderChapter(cursor, chapters[i]);
    toc.push({
      number: chapters[i].number,
      title: chapters[i].title,
      page: startPage,
    });
  }

  // Paint the reserved TOC pages now that we have real chapter page numbers.
  paintTocPages(doc, firstTocPage, tocLayout, chapters, toc);

  // Stamp page-number footers on every non-cover page in a final pass.
  stampFooters(doc);

  return doc;
}

export function downloadVslMasterclassPdf() {
  const doc = generateVslMasterclassPdf();
  doc.save("VSL-Masterclass.pdf");
}
