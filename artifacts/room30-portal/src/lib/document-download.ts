import { jsPDF } from "jspdf";

export interface DownloadableDoc {
  title: string;
  content: string;
  category?: string;
}

const sanitizeFilename = (s: string): string =>
  (s || "document")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "document";

const triggerBlobDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const stripCodeFences = (raw: string): string => {
  if (!raw) return "";
  return raw.replace(/^```[a-zA-Z]*\s*\n?/g, "").replace(/```\s*$/g, "");
};

const sanitizeContentHtml = (raw: string): string => {
  if (!raw) return "";
  if (typeof window === "undefined" || !window.DOMParser) return stripCodeFences(raw);
  const html = stripCodeFences(raw);
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
  } catch {
    return html;
  }
  const DISALLOWED_TAGS = new Set([
    "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META",
    "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "OPTION",
    "BASE", "AUDIO", "VIDEO", "SOURCE",
  ]);
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const toRemove: Element[] = [];
  let node = walker.nextNode() as Element | null;
  while (node) {
    if (DISALLOWED_TAGS.has(node.tagName)) {
      toRemove.push(node);
    } else {
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        const value = (attr.value || "").trim();
        if (name.startsWith("on")) {
          node.removeAttribute(attr.name);
          continue;
        }
        if ((name === "href" || name === "src" || name === "xlink:href") && /^\s*javascript:/i.test(value)) {
          node.removeAttribute(attr.name);
          continue;
        }
        if (name === "srcdoc" || name === "formaction" || name === "action") {
          node.removeAttribute(attr.name);
          continue;
        }
      }
    }
    node = walker.nextNode() as Element | null;
  }
  for (const el of toRemove) el.parentNode?.removeChild(el);
  return doc.body.innerHTML;
};

const wrapAsWordHtml = (bodyHtml: string, title: string): string => {
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #111; line-height: 1.45; }
    h1 { font-size: 22pt; margin: 0 0 12pt; color: #111; }
    h2 { font-size: 16pt; margin: 16pt 0 8pt; color: #111; }
    h3 { font-size: 13pt; margin: 14pt 0 6pt; color: #111; }
    p  { margin: 0 0 8pt; }
    ul, ol { margin: 0 0 10pt 24pt; }
    li { margin-bottom: 4pt; }
    strong, b { font-weight: bold; }
    em, i { font-style: italic; }
    a { color: #0563C1; text-decoration: underline; }
    hr { border: 0; border-top: 1pt solid #999; margin: 18pt 0; }
    .doc-title { font-size: 22pt; font-weight: bold; margin: 0 0 4pt; }
    .doc-meta { font-size: 9pt; color: #666; margin: 0 0 18pt; }
    .doc-section { page-break-after: always; }
    .doc-section:last-child { page-break-after: auto; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
};

const escapeHtml = (s: string): string =>
  (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const renderDocSectionHtml = (doc: DownloadableDoc, includePageBreak: boolean): string => {
  const safeTitle = escapeHtml(doc.title || "Untitled");
  const safeCategory = doc.category ? escapeHtml(doc.category) : "";
  const content = sanitizeContentHtml(doc.content || "");
  return `<div class="${includePageBreak ? "doc-section" : ""}">
  <div class="doc-title">${safeTitle}</div>
  ${safeCategory ? `<div class="doc-meta">${safeCategory}</div>` : ""}
  <div class="doc-body">${content || "<p><em>(no content)</em></p>"}</div>
</div>`;
};

export const downloadDocAsWord = (doc: DownloadableDoc) => {
  const html = wrapAsWordHtml(renderDocSectionHtml(doc, false), doc.title || "Document");
  const blob = new Blob(["\ufeff" + html], { type: "application/msword;charset=utf-8" });
  triggerBlobDownload(blob, `${sanitizeFilename(doc.title)}.doc`);
};

export const downloadManyAsWord = (docs: DownloadableDoc[], baseName = "documents") => {
  if (!docs.length) return;
  if (docs.length === 1) return downloadDocAsWord(docs[0]);
  const body = docs.map((d, i) => renderDocSectionHtml(d, i < docs.length - 1)).join("\n");
  const html = wrapAsWordHtml(body, baseName);
  const blob = new Blob(["\ufeff" + html], { type: "application/msword;charset=utf-8" });
  triggerBlobDownload(blob, `${sanitizeFilename(baseName)}.doc`);
};

const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const PAGE_MARGIN_MM = 18;

interface Cursor {
  y: number;
  topY: number;
  pageBottom: number;
  left: number;
  width: number;
}

interface Style { bold: boolean; italic: boolean }
interface Run { text: string; bold: boolean; italic: boolean }
interface Word { text: string; bold: boolean; italic: boolean; lead: "space" | "none" | "break" }
interface LaidWord { text: string; bold: boolean; italic: boolean; x: number }

const stripPdfUnsupportedChars = (s: string): string =>
  s.replace(
    /[\u{1F000}-\u{1FFFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu,
    "",
  );

const decodeEntities = (s: string): string => {
  if (typeof window === "undefined") return s;
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
};

const fontStyleFor = (b: boolean, i: boolean): "bold" | "italic" | "bolditalic" | "normal" =>
  b && i ? "bolditalic" : b ? "bold" : i ? "italic" : "normal";

const setStyle = (pdf: jsPDF, b: boolean, i: boolean) => {
  pdf.setFont("helvetica", fontStyleFor(b, i));
};

const collectInlineRuns = (node: Node, style: Style): Run[] => {
  if (node.nodeType === Node.TEXT_NODE) {
    const raw = (node.textContent || "").replace(/\s+/g, " ");
    const cleaned = stripPdfUnsupportedChars(raw);
    return cleaned ? [{ text: cleaned, bold: style.bold, italic: style.italic }] : [];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as Element;
  const tag = el.tagName;
  if (tag === "BR") return [{ text: "\n", bold: style.bold, italic: style.italic }];
  let s: Style = { bold: style.bold, italic: style.italic };
  if (tag === "STRONG" || tag === "B") s.bold = true;
  if (tag === "EM" || tag === "I") s.italic = true;
  const out: Run[] = [];
  for (const c of Array.from(el.childNodes)) out.push(...collectInlineRuns(c, s));
  return out;
};

const tokenize = (runs: Run[]): Word[] => {
  const words: Word[] = [];
  let pendingSpace = false;
  for (const run of runs) {
    let text = run.text;
    while (text.length) {
      const brIdx = text.indexOf("\n");
      const segment = brIdx === -1 ? text : text.slice(0, brIdx);
      const tokens = segment.split(/(\s+)/).filter(t => t.length > 0);
      for (const t of tokens) {
        if (/^\s+$/.test(t)) {
          pendingSpace = true;
        } else {
          words.push({
            text: t,
            bold: run.bold,
            italic: run.italic,
            lead: pendingSpace ? "space" : "none",
          });
          pendingSpace = false;
        }
      }
      if (brIdx !== -1) {
        words.push({ text: "", bold: false, italic: false, lead: "break" });
        pendingSpace = false;
        text = text.slice(brIdx + 1);
      } else {
        break;
      }
    }
  }
  return words;
};

const layoutWords = (
  pdf: jsPDF,
  words: Word[],
  fontSize: number,
  maxWidth: number,
): LaidWord[][] => {
  pdf.setFontSize(fontSize);
  const lines: LaidWord[][] = [[]];
  let lineWidth = 0;
  for (const w of words) {
    if (w.lead === "break") {
      lines.push([]);
      lineWidth = 0;
      continue;
    }
    setStyle(pdf, w.bold, w.italic);
    const wordW = pdf.getTextWidth(w.text);
    const cur = lines[lines.length - 1];
    const sepW = cur.length === 0 ? 0 : (w.lead === "space" ? pdf.getTextWidth(" ") : 0);
    if (lineWidth + sepW + wordW > maxWidth && cur.length > 0) {
      lines.push([{ text: w.text, bold: w.bold, italic: w.italic, x: 0 }]);
      lineWidth = wordW;
    } else {
      cur.push({ text: w.text, bold: w.bold, italic: w.italic, x: lineWidth + sepW });
      lineWidth += sepW + wordW;
    }
  }
  return lines;
};

const ensureRoom = (pdf: jsPDF, cursor: Cursor, needed: number) => {
  if (cursor.y + needed > cursor.pageBottom) {
    pdf.addPage();
    cursor.y = cursor.topY;
  }
};

const drawLines = (
  pdf: jsPDF,
  lines: LaidWord[][],
  fontSize: number,
  lineHeight: number,
  startX: number,
  cursor: Cursor,
) => {
  pdf.setFontSize(fontSize);
  pdf.setTextColor(17, 17, 17);
  for (const line of lines) {
    ensureRoom(pdf, cursor, lineHeight);
    for (const w of line) {
      setStyle(pdf, w.bold, w.italic);
      pdf.text(w.text, startX + w.x, cursor.y);
    }
    cursor.y += lineHeight;
  }
};

interface BlockOpts {
  fontSize: number;
  lineHeight: number;
  bold?: boolean;
  italic?: boolean;
  bullet?: string;
  indentMm?: number;
  spaceBeforeMm?: number;
  spaceAfterMm?: number;
  color?: [number, number, number];
}

const renderTextBlock = (pdf: jsPDF, el: Element, cursor: Cursor, opts: BlockOpts) => {
  if (opts.spaceBeforeMm) cursor.y += opts.spaceBeforeMm;
  const indent = opts.indentMm || 0;
  const startX = cursor.left + indent;
  const blockWidth = cursor.width - indent;
  const baseStyle: Style = { bold: !!opts.bold, italic: !!opts.italic };
  const runs = collectInlineRuns(el, baseStyle);
  const words = tokenize(runs);
  if (opts.bullet) {
    ensureRoom(pdf, cursor, opts.lineHeight);
    pdf.setFontSize(opts.fontSize);
    setStyle(pdf, false, false);
    pdf.setTextColor(80, 80, 80);
    pdf.text(opts.bullet, cursor.left + Math.max(0, indent - 5), cursor.y);
  }
  if (!words.length && !opts.bullet) {
    cursor.y += opts.lineHeight * 0.5;
    return;
  }
  if (!words.length && opts.bullet) {
    cursor.y += opts.lineHeight;
    if (opts.spaceAfterMm) cursor.y += opts.spaceAfterMm;
    return;
  }
  const lines = layoutWords(pdf, words, opts.fontSize, blockWidth);
  if (opts.color) pdf.setTextColor(...opts.color);
  drawLines(pdf, lines, opts.fontSize, opts.lineHeight, startX, cursor);
  if (opts.spaceAfterMm) cursor.y += opts.spaceAfterMm;
};

const walkBlocks = (pdf: jsPDF, parent: Element, cursor: Cursor) => {
  for (const child of Array.from(parent.children)) {
    const tag = child.tagName;
    switch (tag) {
      case "H1":
        renderTextBlock(pdf, child, cursor, { fontSize: 18, lineHeight: 8, bold: true, spaceBeforeMm: 4, spaceAfterMm: 3 });
        break;
      case "H2":
        renderTextBlock(pdf, child, cursor, { fontSize: 14, lineHeight: 6.5, bold: true, spaceBeforeMm: 4, spaceAfterMm: 2.5 });
        break;
      case "H3":
        renderTextBlock(pdf, child, cursor, { fontSize: 12, lineHeight: 5.5, bold: true, spaceBeforeMm: 3, spaceAfterMm: 2 });
        break;
      case "H4":
      case "H5":
      case "H6":
        renderTextBlock(pdf, child, cursor, { fontSize: 11.5, lineHeight: 5.2, bold: true, spaceBeforeMm: 2.5, spaceAfterMm: 1.5 });
        break;
      case "P":
        renderTextBlock(pdf, child, cursor, { fontSize: 11, lineHeight: 5.4, spaceAfterMm: 2 });
        break;
      case "BLOCKQUOTE":
        renderTextBlock(pdf, child, cursor, { fontSize: 11, lineHeight: 5.4, italic: true, indentMm: 6, spaceAfterMm: 2 });
        break;
      case "UL":
      case "OL": {
        let counter = 1;
        for (const li of Array.from(child.children)) {
          if (li.tagName !== "LI") continue;
          const bullet = tag === "UL" ? "\u2022" : `${counter}.`;
          renderTextBlock(pdf, li, cursor, { fontSize: 11, lineHeight: 5.4, bullet, indentMm: 6, spaceAfterMm: 1 });
          counter++;
        }
        cursor.y += 1.5;
        break;
      }
      case "HR": {
        cursor.y += 2;
        ensureRoom(pdf, cursor, 5);
        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.2);
        pdf.line(cursor.left, cursor.y, cursor.left + cursor.width, cursor.y);
        cursor.y += 4;
        break;
      }
      case "DIV":
      case "SECTION":
      case "ARTICLE":
      case "MAIN":
      case "HEADER":
      case "FOOTER":
        if (child.children.length === 0) {
          renderTextBlock(pdf, child, cursor, { fontSize: 11, lineHeight: 5.4, spaceAfterMm: 2 });
        } else {
          walkBlocks(pdf, child, cursor);
        }
        break;
      case "PRE":
      case "CODE":
        renderTextBlock(pdf, child, cursor, { fontSize: 10, lineHeight: 5, spaceAfterMm: 2 });
        break;
      default:
        renderTextBlock(pdf, child, cursor, { fontSize: 11, lineHeight: 5.4, spaceAfterMm: 2 });
    }
  }
};

const renderHtmlBodyToPdf = (pdf: jsPDF, html: string, cursor: Cursor) => {
  const sanitized = sanitizeContentHtml(html || "");
  const safeHtml = sanitized || "<p><em>(no content)</em></p>";
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${safeHtml}</body>`, "text/html");
  walkBlocks(pdf, doc.body, cursor);
};

const newCursor = (): Cursor => ({
  y: PAGE_MARGIN_MM,
  topY: PAGE_MARGIN_MM,
  pageBottom: PAGE_HEIGHT_MM - PAGE_MARGIN_MM,
  left: PAGE_MARGIN_MM,
  width: PAGE_WIDTH_MM - PAGE_MARGIN_MM * 2,
});

const renderDocHeader = (pdf: jsPDF, doc: DownloadableDoc, cursor: Cursor) => {
  const title = stripPdfUnsupportedChars(decodeEntities(doc.title || "Untitled"));
  const category = doc.category ? stripPdfUnsupportedChars(decodeEntities(doc.category)) : "";

  ensureRoom(pdf, cursor, 12);
  pdf.setFontSize(20);
  setStyle(pdf, true, false);
  pdf.setTextColor(17, 17, 17);
  const titleLines = pdf.splitTextToSize(title, cursor.width) as string[];
  for (const line of titleLines) {
    ensureRoom(pdf, cursor, 9);
    pdf.text(line, cursor.left, cursor.y);
    cursor.y += 8.5;
  }

  if (category) {
    ensureRoom(pdf, cursor, 6);
    pdf.setFontSize(10);
    setStyle(pdf, false, false);
    pdf.setTextColor(110, 110, 110);
    pdf.text(category, cursor.left, cursor.y);
    cursor.y += 5;
  }

  cursor.y += 4;
  pdf.setDrawColor(220, 220, 220);
  pdf.setLineWidth(0.2);
  pdf.line(cursor.left, cursor.y, cursor.left + cursor.width, cursor.y);
  cursor.y += 5;
  pdf.setTextColor(17, 17, 17);
};

const renderDocToPdf = (pdf: jsPDF, doc: DownloadableDoc, cursor: Cursor) => {
  renderDocHeader(pdf, doc, cursor);
  renderHtmlBodyToPdf(pdf, doc.content || "", cursor);
};

export const downloadDocAsPdf = async (doc: DownloadableDoc) => {
  await downloadManyAsPdf([doc], doc.title || "document");
};

export const downloadManyAsPdf = async (docs: DownloadableDoc[], baseName = "documents") => {
  if (!docs.length) return;
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const cursor = newCursor();
  for (let i = 0; i < docs.length; i++) {
    if (i > 0) {
      pdf.addPage();
      cursor.y = cursor.topY;
    }
    renderDocToPdf(pdf, docs[i], cursor);
  }
  pdf.save(`${sanitizeFilename(baseName)}.pdf`);
};
