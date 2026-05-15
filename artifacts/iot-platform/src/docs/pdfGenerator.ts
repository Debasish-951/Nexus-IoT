import { jsPDF } from "jspdf";
import { buildDocumentContent, PLATFORM_NAME, PLATFORM_VERSION, DOC_DATE, type ContentItem } from "./content";

export type PdfGenerateOptions = {
  items?: ContentItem[];
  version?: string;
  date?: string;
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_L = 18;
const MARGIN_R = 18;
const MARGIN_T = 22;
const MARGIN_B = 20;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

const COLOR_H1    = [30,  58,  95] as const;
const COLOR_H2    = [29,  78, 216] as const;
const COLOR_H3    = [3,  105, 161] as const;
const COLOR_BODY  = [55,  65,  81] as const;
const COLOR_NOTE  = [91,  33, 182] as const;
const COLOR_CODE  = [30,  41,  59] as const;
const COLOR_HEAD  = [158, 163, 175] as const;
const COLOR_TH_BG = [30,  58,  95] as const;
const COLOR_TR_ALT= [249, 250, 251] as const;
const COLOR_BORDER= [209, 213, 219] as const;
const COLOR_NOTE_BG=[245, 243, 255] as const;
const COLOR_CODE_BG=[243, 244, 246] as const;
const COLOR_WHITE = [255, 255, 255] as const;

function setColor(doc: jsPDF, rgb: readonly [number, number, number]) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

function setFill(doc: jsPDF, rgb: readonly [number, number, number]) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}

function setDraw(doc: jsPDF, rgb: readonly [number, number, number]) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

interface Ctx {
  doc: jsPDF;
  y: number;
  pageNum: number;
  totalPages: number;
}

interface RenderMeta { version: string; date: string; }

function addHeader(ctx: Ctx, meta: RenderMeta) {
  const doc = ctx.doc;
  if (ctx.pageNum === 1) return;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  setColor(doc, COLOR_HEAD);
  doc.text(`${PLATFORM_NAME} — Platform Documentation v${meta.version}`, MARGIN_L, 12);
  doc.text(`Page ${ctx.pageNum}`, PAGE_W - MARGIN_R, 12, { align: "right" });
  doc.setDrawColor(209, 213, 219);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_L, 14, PAGE_W - MARGIN_R, 14);
}

function addFooter(doc: jsPDF, meta: RenderMeta) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setColor(doc, COLOR_HEAD);
  const footerY = PAGE_H - 8;
  doc.setDrawColor(209, 213, 219);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_L, footerY - 3, PAGE_W - MARGIN_R, footerY - 3);
  doc.text(`${PLATFORM_NAME} v${meta.version}  |  ${meta.date}  |  Confidential`, PAGE_W / 2, footerY, { align: "center" });
}

function ensureSpace(ctx: Ctx, needed: number, meta: RenderMeta): void {
  if (ctx.y + needed > PAGE_H - MARGIN_B) {
    addFooter(ctx.doc, meta);
    ctx.doc.addPage();
    ctx.pageNum++;
    addHeader(ctx, meta);
    ctx.y = MARGIN_T + 4;
  }
}

function drawWrappedText(
  ctx: Ctx,
  text: string,
  x: number,
  maxWidth: number,
  lineHeight: number,
  meta: RenderMeta,
  indent = 0
): void {
  const lines = ctx.doc.splitTextToSize(text, maxWidth - indent);
  for (const line of lines) {
    ensureSpace(ctx, lineHeight, meta);
    ctx.doc.text(line, x + indent, ctx.y);
    ctx.y += lineHeight;
  }
}

function renderItem(ctx: Ctx, item: ContentItem, meta: RenderMeta): void {
  const doc = ctx.doc;

  switch (item.type) {
    case "h1": {
      ensureSpace(ctx, 18, meta);
      ctx.y += 4;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      setColor(doc, COLOR_H1);
      const lines = doc.splitTextToSize(item.text, CONTENT_W);
      for (const line of lines) {
        ensureSpace(ctx, 10, meta);
        doc.text(line, MARGIN_L, ctx.y);
        ctx.y += 9;
      }
      ctx.y += 2;
      break;
    }

    case "h2": {
      ensureSpace(ctx, 14, meta);
      ctx.y += 3;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      setColor(doc, COLOR_H2);
      const lines = doc.splitTextToSize(item.text, CONTENT_W);
      for (const line of lines) {
        ensureSpace(ctx, 7, meta);
        doc.text(line, MARGIN_L, ctx.y);
        ctx.y += 6.5;
      }
      ctx.y += 1;
      break;
    }

    case "h3": {
      ensureSpace(ctx, 10, meta);
      ctx.y += 2;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      setColor(doc, COLOR_H3);
      const lines = doc.splitTextToSize(item.text, CONTENT_W);
      for (const line of lines) {
        ensureSpace(ctx, 6, meta);
        doc.text(line, MARGIN_L, ctx.y);
        ctx.y += 5.5;
      }
      ctx.y += 1;
      break;
    }

    case "p": {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setColor(doc, COLOR_BODY);
      const lines = doc.splitTextToSize(item.text, CONTENT_W);
      for (const line of lines) {
        ensureSpace(ctx, 5.5, meta);
        doc.text(line, MARGIN_L, ctx.y);
        ctx.y += 5;
      }
      ctx.y += 1.5;
      break;
    }

    case "ul": {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setColor(doc, COLOR_BODY);
      for (const item_ of item.items) {
        const lines = doc.splitTextToSize(item_, CONTENT_W - 6);
        for (let i = 0; i < lines.length; i++) {
          ensureSpace(ctx, 5.5, meta);
          if (i === 0) doc.text("•", MARGIN_L + 1, ctx.y);
          doc.text(lines[i], MARGIN_L + 5, ctx.y);
          ctx.y += 5;
        }
      }
      ctx.y += 2;
      break;
    }

    case "ol": {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setColor(doc, COLOR_BODY);
      for (let i = 0; i < item.items.length; i++) {
        const lines = doc.splitTextToSize(item.items[i], CONTENT_W - 8);
        for (let j = 0; j < lines.length; j++) {
          ensureSpace(ctx, 5.5, meta);
          if (j === 0) doc.text(`${i + 1}.`, MARGIN_L + 1, ctx.y);
          doc.text(lines[j], MARGIN_L + 7, ctx.y);
          ctx.y += 5;
        }
      }
      ctx.y += 2;
      break;
    }

    case "table": {
      const colCount = item.headers.length;
      const colW = CONTENT_W / colCount;
      const rowH = 6.5;
      const headerH = 7.5;

      ensureSpace(ctx, headerH + rowH * Math.min(item.rows.length, 3), meta);

      const startX = MARGIN_L;

      setFill(doc, COLOR_TH_BG);
      setDraw(doc, COLOR_BORDER);
      doc.setLineWidth(0.3);
      doc.rect(startX, ctx.y - 5, CONTENT_W, headerH, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      setColor(doc, COLOR_WHITE);
      for (let c = 0; c < colCount; c++) {
        const cellX = startX + c * colW;
        const headerText = doc.splitTextToSize(item.headers[c], colW - 3);
        doc.text(headerText[0] ?? "", cellX + 2, ctx.y);
      }
      ctx.y += headerH - 1;

      for (let r = 0; r < item.rows.length; r++) {
        const row = item.rows[r];
        const isAlt = r % 2 === 1;
        ensureSpace(ctx, rowH + 2, meta);

        if (isAlt) {
          setFill(doc, COLOR_TR_ALT);
          doc.rect(startX, ctx.y - 5, CONTENT_W, rowH, "F");
        }

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        setColor(doc, COLOR_BODY);

        for (let c = 0; c < colCount; c++) {
          const cellX = startX + c * colW;
          const cellText = doc.splitTextToSize(row[c] ?? "", colW - 3);
          if (c === 0) doc.setFont("helvetica", "bold");
          else doc.setFont("helvetica", "normal");
          doc.text(cellText[0] ?? "", cellX + 2, ctx.y);
        }

        setDraw(doc, COLOR_BORDER);
        doc.setLineWidth(0.2);
        doc.line(startX, ctx.y + 1.5, startX + CONTENT_W, ctx.y + 1.5);
        ctx.y += rowH;
      }

      ctx.y += 4;
      break;
    }

    case "code": {
      const lines = item.text.split("\n");
      const lineH = 4.5;
      const boxH = lines.length * lineH + 6;

      ensureSpace(ctx, Math.min(boxH, 40), meta);

      const boxY = ctx.y - 4;
      setFill(doc, COLOR_CODE_BG);
      setDraw(doc, COLOR_BORDER);
      doc.setLineWidth(0.3);
      doc.rect(MARGIN_L, boxY, CONTENT_W, Math.min(boxH, 40), "FD");

      doc.setFont("courier", "normal");
      doc.setFontSize(7.5);
      setColor(doc, COLOR_CODE);
      doc.text(`[${item.lang}]`, MARGIN_L + 2, ctx.y - 0.5);
      ctx.y += 3.5;

      const maxLines = Math.floor((PAGE_H - MARGIN_B - ctx.y) / lineH);
      const visibleLines = lines.slice(0, Math.min(lines.length, maxLines));
      for (const ln of visibleLines) {
        ensureSpace(ctx, lineH + 1, meta);
        const clipped = doc.splitTextToSize(ln, CONTENT_W - 4);
        doc.text(clipped[0] ?? "", MARGIN_L + 2, ctx.y);
        ctx.y += lineH;
      }
      ctx.y += 4;
      break;
    }

    case "note": {
      const noteLines = doc.splitTextToSize(`⚠ Note: ${item.text}`, CONTENT_W - 6);
      const boxH = noteLines.length * 4.8 + 5;
      ensureSpace(ctx, boxH, meta);

      setFill(doc, COLOR_NOTE_BG);
      setDraw(doc, [209, 196, 233] as any);
      doc.setLineWidth(0.3);
      doc.rect(MARGIN_L, ctx.y - 4, CONTENT_W, boxH, "FD");

      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      setColor(doc, COLOR_NOTE);
      for (const line of noteLines) {
        doc.text(line, MARGIN_L + 3, ctx.y);
        ctx.y += 4.8;
      }
      ctx.y += 3;
      break;
    }

    case "divider": {
      ensureSpace(ctx, 6, meta);
      ctx.y += 2;
      setDraw(doc, COLOR_BORDER);
      doc.setLineWidth(0.4);
      doc.line(MARGIN_L, ctx.y, PAGE_W - MARGIN_R, ctx.y);
      ctx.y += 4;
      break;
    }

    case "pagebreak": {
      addFooter(doc, meta);
      doc.addPage();
      ctx.pageNum++;
      addHeader(ctx, meta);
      ctx.y = MARGIN_T + 4;
      break;
    }
  }
}

export async function generatePdf(
  _onProgress?: (msg: string) => void,
  opts?: PdfGenerateOptions
): Promise<void> {
  const meta: RenderMeta = {
    version: opts?.version ?? PLATFORM_VERSION,
    date: opts?.date ?? DOC_DATE,
  };
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  const items = opts?.items ?? buildDocumentContent();
  const ctx: Ctx = { doc, y: MARGIN_T + 4, pageNum: 1, totalPages: 1 };

  addHeader(ctx, meta);

  for (const item of items) {
    renderItem(ctx, item, meta);
  }

  addFooter(doc, meta);

  const filename = `${PLATFORM_NAME.replace(/\s+/g, "-")}-Documentation-v${meta.version}.pdf`;
  doc.save(filename);
}
