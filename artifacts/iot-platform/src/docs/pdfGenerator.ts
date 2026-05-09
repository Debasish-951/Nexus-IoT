import { buildDocumentContent, PLATFORM_NAME, PLATFORM_VERSION, DOC_DATE, type ContentItem } from "./content";

declare global {
  interface Window {
    pdfMake: any;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function getPdfMake(): Promise<any> {
  if (window.pdfMake) return window.pdfMake;
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.min.js");
  return window.pdfMake;
}

function colorFromType(type: string): string {
  const map: Record<string, string> = {
    h1: "#1e3a5f",
    h2: "#1d4ed8",
    h3: "#0369a1",
    note: "#7c3aed",
  };
  return map[type] ?? "#111827";
}

function buildPdfContent(items: ContentItem[]): any[] {
  const out: any[] = [];

  for (const item of items) {
    switch (item.type) {
      case "h1":
        out.push({
          text: item.text,
          style: "h1",
          color: colorFromType("h1"),
        });
        break;

      case "h2":
        out.push({
          text: item.text,
          style: "h2",
          color: colorFromType("h2"),
        });
        break;

      case "h3":
        out.push({
          text: item.text,
          style: "h3",
          color: colorFromType("h3"),
        });
        break;

      case "p":
        out.push({ text: item.text, style: "body" });
        break;

      case "ul":
        out.push({
          ul: item.items.map((t) => ({ text: t, style: "listItem" })),
          style: "list",
        });
        break;

      case "ol":
        out.push({
          ol: item.items.map((t) => ({ text: t, style: "listItem" })),
          style: "list",
        });
        break;

      case "table":
        out.push({
          style: "tableStyle",
          table: {
            headerRows: 1,
            widths: Array(item.headers.length).fill("*"),
            body: [
              item.headers.map((h) => ({
                text: h,
                style: "tableHeader",
                fillColor: "#1e3a5f",
                color: "#ffffff",
              })),
              ...item.rows.map((row) =>
                row.map((cell, ci) => ({
                  text: cell,
                  style: ci === 0 ? "tableCellBold" : "tableCell",
                }))
              ),
            ],
          },
          layout: {
            hLineWidth: (i: number, node: any) =>
              i === 0 || i === node.table.body.length ? 1 : 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => "#d1d5db",
            vLineColor: () => "#d1d5db",
            fillColor: (rowIndex: number) => (rowIndex % 2 === 0 ? null : "#f9fafb"),
          },
        });
        break;

      case "code":
        out.push({
          stack: [
            {
              text: `[${item.lang}]`,
              style: "codeLabel",
            },
            {
              text: item.text,
              style: "codeBlock",
            },
          ],
          margin: [0, 4, 0, 8],
        });
        break;

      case "note":
        out.push({
          stack: [
            {
              text: `⚠ Note: ${item.text}`,
              style: "note",
            },
          ],
          margin: [0, 4, 0, 8],
        });
        break;

      case "divider":
        out.push({
          canvas: [
            {
              type: "line",
              x1: 0,
              y1: 4,
              x2: 515,
              y2: 4,
              lineWidth: 1,
              lineColor: "#d1d5db",
            },
          ],
          margin: [0, 8, 0, 8],
        });
        break;

      case "pagebreak":
        out.push({ text: "", pageBreak: "after" });
        break;
    }
  }
  return out;
}

export async function generatePdf(
  onProgress?: (msg: string) => void
): Promise<void> {
  onProgress?.("Loading PDF engine…");
  const pdfMake = await getPdfMake();

  onProgress?.("Building document…");
  const items = buildDocumentContent();
  const content = buildPdfContent(items);

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [56, 72, 56, 60],

    header: (currentPage: number, pageCount: number) => {
      if (currentPage === 1) return null;
      return {
        columns: [
          { text: `${PLATFORM_NAME} — User Manual & Technical Documentation`, style: "headerText", alignment: "left" },
          { text: `Page ${currentPage} of ${pageCount}`, style: "headerText", alignment: "right" },
        ],
        margin: [56, 20, 56, 0],
      };
    },

    footer: (_currentPage: number) => ({
      text: `${PLATFORM_NAME} v${PLATFORM_VERSION}  |  ${DOC_DATE}  |  Confidential`,
      style: "footerText",
      alignment: "center",
      margin: [56, 0, 56, 20],
    }),

    content,

    styles: {
      h1: {
        fontSize: 22,
        bold: true,
        margin: [0, 20, 0, 10],
        lineHeight: 1.3,
      },
      h2: {
        fontSize: 15,
        bold: true,
        margin: [0, 16, 0, 6],
        lineHeight: 1.2,
      },
      h3: {
        fontSize: 12,
        bold: true,
        margin: [0, 12, 0, 4],
        lineHeight: 1.2,
      },
      body: {
        fontSize: 10,
        margin: [0, 0, 0, 6],
        lineHeight: 1.5,
        color: "#374151",
      },
      list: {
        margin: [0, 0, 0, 8],
      },
      listItem: {
        fontSize: 10,
        lineHeight: 1.5,
        color: "#374151",
      },
      tableStyle: {
        margin: [0, 6, 0, 14],
        fontSize: 9,
      },
      tableHeader: {
        bold: true,
        fontSize: 9,
        lineHeight: 1.3,
      },
      tableCell: {
        fontSize: 9,
        lineHeight: 1.4,
        color: "#374151",
      },
      tableCellBold: {
        fontSize: 9,
        bold: true,
        lineHeight: 1.4,
        color: "#111827",
      },
      codeBlock: {
        font: "Courier",
        fontSize: 8.5,
        background: "#f3f4f6",
        color: "#1e293b",
        lineHeight: 1.5,
        margin: [0, 0, 0, 0],
        preserveLeadingSpaces: true,
      },
      codeLabel: {
        fontSize: 8,
        color: "#6b7280",
        bold: true,
        margin: [0, 0, 0, 2],
      },
      note: {
        fontSize: 9.5,
        italics: true,
        color: "#5b21b6",
        background: "#f5f3ff",
        lineHeight: 1.5,
        margin: [8, 0, 8, 0],
      },
      headerText: {
        fontSize: 8,
        color: "#9ca3af",
        italics: true,
      },
      footerText: {
        fontSize: 8,
        color: "#9ca3af",
      },
    },

    defaultStyle: {
      font: "Roboto",
      fontSize: 10,
      color: "#111827",
    },
  };

  onProgress?.("Rendering PDF…");
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(docDefinition).download(
        `${PLATFORM_NAME.replace(/\s+/g, "-")}-Documentation-v${PLATFORM_VERSION}.pdf`,
        () => resolve()
      );
    } catch (err) {
      reject(err);
    }
  });
}
