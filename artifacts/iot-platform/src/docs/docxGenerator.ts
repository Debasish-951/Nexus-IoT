import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  PageBreak,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  convertInchesToTwip,
} from "docx";
import { saveAs } from "file-saver";
import {
  buildDocumentContent,
  PLATFORM_NAME,
  PLATFORM_VERSION,
  DOC_DATE,
  type ContentItem,
} from "./content";

const PRIMARY = "1e3a5f";
const ACCENT = "1d4ed8";
const LIGHT = "0369a1";
const NOTE_BG = "f5f3ff";
const NOTE_COLOR = "5b21b6";
const CODE_BG = "f3f4f6";
const TABLE_HEADER_BG = "1e3a5f";
const TABLE_ALT = "f9fafb";

function h1Paragraph(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: convertInchesToTwip(0.25), after: convertInchesToTwip(0.1) },
    children: [
      new TextRun({
        text,
        bold: true,
        color: PRIMARY,
        size: 36,
        font: "Calibri",
      }),
    ],
    border: {
      bottom: {
        color: PRIMARY,
        space: 4,
        style: BorderStyle.SINGLE,
        size: 6,
      },
    },
  });
}

function h2Paragraph(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: convertInchesToTwip(0.2), after: convertInchesToTwip(0.08) },
    children: [
      new TextRun({
        text,
        bold: true,
        color: ACCENT,
        size: 28,
        font: "Calibri",
      }),
    ],
  });
}

function h3Paragraph(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: convertInchesToTwip(0.15), after: convertInchesToTwip(0.06) },
    children: [
      new TextRun({
        text,
        bold: true,
        color: LIGHT,
        size: 24,
        font: "Calibri",
      }),
    ],
  });
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 100 },
    children: [
      new TextRun({
        text,
        size: 20,
        font: "Calibri",
        color: "374151",
      }),
    ],
  });
}

function bulletParagraph(text: string, ordered: boolean, index: number): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: convertInchesToTwip(0.25) },
    children: [
      new TextRun({
        text: ordered ? `${index + 1}. ${text}` : `• ${text}`,
        size: 20,
        font: "Calibri",
        color: "374151",
      }),
    ],
  });
}

function codeParagraph(lang: string, text: string): Paragraph[] {
  const label = new Paragraph({
    spacing: { before: 80, after: 40 },
    children: [
      new TextRun({
        text: `[${lang}]`,
        size: 16,
        font: "Courier New",
        color: "6b7280",
        bold: true,
      }),
    ],
  });

  const lines = text.split("\n");
  const codeParas = lines.map(
    (line) =>
      new Paragraph({
        spacing: { after: 20 },
        shading: {
          type: ShadingType.CLEAR,
          fill: CODE_BG,
        },
        children: [
          new TextRun({
            text: line || " ",
            size: 17,
            font: "Courier New",
            color: "1e293b",
          }),
        ],
      })
  );

  return [label, ...codeParas];
}

function noteParagraph(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 100 },
    indent: { left: convertInchesToTwip(0.2), right: convertInchesToTwip(0.2) },
    shading: {
      type: ShadingType.CLEAR,
      fill: NOTE_BG,
    },
    children: [
      new TextRun({
        text: `⚠ Note: ${text}`,
        size: 19,
        font: "Calibri",
        color: NOTE_COLOR,
        italics: true,
      }),
    ],
  });
}

function dividerParagraph(): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    border: {
      bottom: { color: "d1d5db", style: BorderStyle.SINGLE, size: 4, space: 1 },
    },
    children: [],
  });
}

function buildTable(headers: string[], rows: string[][]): Table {
  const colCount = headers.length;
  const colWidth = Math.floor(9000 / colCount);

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(
      (h) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill: TABLE_HEADER_BG },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: h,
                  bold: true,
                  color: "FFFFFF",
                  size: 18,
                  font: "Calibri",
                }),
              ],
            }),
          ],
          width: { size: colWidth, type: WidthType.DXA },
        })
    ),
  });

  const dataRows = rows.map(
    (row, ri) =>
      new TableRow({
        children: row.map(
          (cell, ci) =>
            new TableCell({
              shading:
                ri % 2 === 1
                  ? { type: ShadingType.CLEAR, fill: TABLE_ALT }
                  : undefined,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: cell,
                      size: 18,
                      font: "Calibri",
                      color: "374151",
                      bold: ci === 0,
                    }),
                  ],
                }),
              ],
              width: { size: colWidth, type: WidthType.DXA },
            })
        ),
      })
  );

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 9000, type: WidthType.DXA },
    margins: {
      top: convertInchesToTwip(0.04),
      bottom: convertInchesToTwip(0.04),
      left: convertInchesToTwip(0.08),
      right: convertInchesToTwip(0.08),
    },
  });
}

function buildDocxChildren(items: ContentItem[]): any[] {
  const children: any[] = [];

  for (const item of items) {
    switch (item.type) {
      case "h1":
        children.push(h1Paragraph(item.text));
        break;
      case "h2":
        children.push(h2Paragraph(item.text));
        break;
      case "h3":
        children.push(h3Paragraph(item.text));
        break;
      case "p":
        children.push(bodyParagraph(item.text));
        break;
      case "ul":
        item.items.forEach((t, i) => children.push(bulletParagraph(t, false, i)));
        break;
      case "ol":
        item.items.forEach((t, i) => children.push(bulletParagraph(t, true, i)));
        break;
      case "table":
        children.push(
          new Paragraph({ spacing: { before: 80 }, children: [] }),
          buildTable(item.headers, item.rows),
          new Paragraph({ spacing: { after: 80 }, children: [] })
        );
        break;
      case "code":
        children.push(...codeParagraph(item.lang, item.text));
        break;
      case "note":
        children.push(noteParagraph(item.text));
        break;
      case "divider":
        children.push(dividerParagraph());
        break;
      case "pagebreak":
        children.push(
          new Paragraph({
            children: [new PageBreak()],
          })
        );
        break;
    }
  }

  return children;
}

export async function generateDocx(
  onProgress?: (msg: string) => void
): Promise<void> {
  onProgress?.("Building document structure…");
  const items = buildDocumentContent();

  onProgress?.("Rendering Word document…");
  const children = buildDocxChildren(items);

  const doc = new Document({
    title: `${PLATFORM_NAME} — User Manual & Technical Documentation`,
    description: `Version ${PLATFORM_VERSION} — ${DOC_DATE}`,
    creator: PLATFORM_NAME,
    subject: "Industrial IoT Platform Documentation",
    keywords: "IoT, MQTT, Telemetry, Alarms, Dashboard",

    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 20 },
        },
      },
    },

    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.2),
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                border: {
                  bottom: { color: "d1d5db", style: BorderStyle.SINGLE, size: 4, space: 4 },
                },
                children: [
                  new TextRun({
                    text: `${PLATFORM_NAME} — Platform Documentation  |  Page `,
                    size: 16,
                    color: "9ca3af",
                    font: "Calibri",
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: "9ca3af",
                    font: "Calibri",
                  }),
                  new TextRun({
                    text: " of ",
                    size: 16,
                    color: "9ca3af",
                    font: "Calibri",
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: "9ca3af",
                    font: "Calibri",
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                border: {
                  top: { color: "d1d5db", style: BorderStyle.SINGLE, size: 4, space: 4 },
                },
                children: [
                  new TextRun({
                    text: `${PLATFORM_NAME} v${PLATFORM_VERSION}  |  ${DOC_DATE}  |  Confidential`,
                    size: 16,
                    color: "9ca3af",
                    italics: true,
                    font: "Calibri",
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],

    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: NumberFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
  });

  onProgress?.("Packaging file…");
  const blob = await Packer.toBlob(doc);
  saveAs(
    blob,
    `${PLATFORM_NAME.replace(/\s+/g, "-")}-Documentation-v${PLATFORM_VERSION}.docx`
  );
  onProgress?.("Done");
}
