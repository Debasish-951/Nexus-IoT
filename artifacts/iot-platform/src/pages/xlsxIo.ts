/**
 * Minimal XLSX reader/writer — no dependency.
 *
 * A CSV cannot carry formatting, so the onboarding worksheet is written as a real
 * workbook: green header row, frozen top row, sensible column widths, and Excel
 * dropdowns on the columns the user is expected to fill in. Reading exists so the
 * same file can come straight back in without a "save as CSV" detour.
 *
 * Only what the round-trip needs is implemented: a single stored (uncompressed) sheet
 * on write; on read, stored or deflated entries, inline/shared/plain cell values.
 */

const enc = new TextEncoder();

// ── CRC-32 (zip entries carry one) ───────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const xmlEsc = (s: string) => s
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// ── Zip writer (store only — Excel reads uncompressed entries happily) ───────
interface ZipEntry { name: string; data: Uint8Array }

function zip(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);        // version needed
    lv.setUint16(6, 0x0800, true);    // UTF-8 names
    lv.setUint16(8, 0, true);         // method: store
    lv.setUint16(10, 0, true);        // mod time — fixed, so output is deterministic
    lv.setUint16(12, 0x0021, true);   // mod date = 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);        // version made by
    cv.setUint16(6, 20, true);        // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x0021, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);   // local header offset
    cd.set(nameBytes, 46);

    chunks.push(local, e.data);
    central.push(cd);
    offset += local.length + e.data.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const all = [...chunks, ...central, eocd];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

// ── Workbook parts ───────────────────────────────────────────────────────────
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

/** Fills 0 and 1 must stay "none" and "gray125" — Excel reserves them. Green is 2. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF00B050"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const colName = (i: number): string => {
  let s = ""; let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
};

export type CellValue = string | number | null | undefined;

/** One column's Excel dropdown, applied to every data row. */
export interface ColumnChoices { column: number; values: string[] }

export interface SheetSpec {
  sheetName: string;
  headers: string[];
  rows: CellValue[][];
  colWidths?: number[];
  /** Dropdowns for the columns the user fills in by hand. */
  choices?: ColumnChoices[];
}

function cellXml(ref: string, v: CellValue, styleId: number): string {
  const s = styleId ? ` s="${styleId}"` : "";
  if (v === null || v === undefined || v === "") return `<c r="${ref}"${s}/>`;
  if (typeof v === "number") return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
}

export function buildXlsx(spec: SheetSpec): Uint8Array {
  const { sheetName, headers, rows, colWidths, choices } = spec;

  const cols = colWidths?.length
    ? `<cols>${colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";

  const headerRow = `<row r="1">${headers.map((h, i) => cellXml(`${colName(i)}1`, h, 1)).join("")}</row>`;
  const dataRows = rows.map((r, ri) =>
    `<row r="${ri + 2}">${r.map((v, ci) => cellXml(`${colName(ci)}${ri + 2}`, v, 0)).join("")}</row>`).join("");

  // Validation covers well past the last row so pasted-in rows keep the dropdowns.
  const lastRow = Math.max(rows.length + 1, 500);
  const validations = choices?.length
    ? `<dataValidations count="${choices.length}">${choices.map((c) => {
        const col = colName(c.column);
        return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${col}2:${col}${lastRow}"><formula1>"${c.values.join(",")}"</formula1></dataValidation>`;
      }).join("")}</dataValidations>`
    : "";

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${headerRow}${dataRows}</sheetData>${validations}</worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  return zip([
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: enc.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(WORKBOOK_RELS) },
    { name: "xl/styles.xml", data: enc.encode(STYLES) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheet) },
  ]);
}

// ── Reading ──────────────────────────────────────────────────────────────────
interface ZipIndexEntry { name: string; method: number; compSize: number; localOffset: number }

function readZipIndex(buf: Uint8Array): ZipIndexEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("Not a valid .xlsx file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipIndexEntry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readEntry(buf: Uint8Array, e: ZipIndexEntry): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nameLen = dv.getUint16(e.localOffset + 26, true);
  const extraLen = dv.getUint16(e.localOffset + 28, true);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return new TextDecoder().decode(raw);
  if (e.method !== 8) throw new Error(`Unsupported compression in ${e.name}.`);
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot read compressed .xlsx files — re-save the sheet as CSV and import that.");
  }
  const stream = new Blob([raw.slice().buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const xmlUnesc = (s: string) => s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, code: string) => {
  if (code[0] === "#") {
    const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  }
  return XML_ENTITIES[code] ?? m;
});

/** Concatenated text of every <t> in a fragment (rich-text runs included). */
function textOf(fragment: string): string {
  let s = "";
  for (const m of fragment.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += xmlUnesc(m[1]);
  return s;
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
}

/** Sheet XML → a rectangular string matrix, gaps filled so column positions hold. */
function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\s([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[3] ?? "";
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      let idx = cells.length;
      if (ref) {
        idx = 0;
        for (const ch of ref) idx = idx * 26 + (ch.charCodeAt(0) - 64);
        idx -= 1;
      }
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      let value = "";
      if (type === "s") {
        const i = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "-1");
        value = shared[i] ?? "";
      } else if (type === "inlineStr") {
        value = textOf(body);
      } else {
        value = xmlUnesc(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      }
      while (cells.length < idx) cells.push("");
      cells[idx] = value.trim();
    }
    rows.push(cells);
  }
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map((r) => { while (r.length < width) r.push(""); return r; });
}

export interface ReadXlsxResult { rows: string[][]; sheetCount: number }

/** Reads the FIRST worksheet of a workbook into a string matrix. */
export async function readXlsx(buffer: ArrayBuffer): Promise<ReadXlsxResult> {
  const buf = new Uint8Array(buffer);
  const index = readZipIndex(buf);
  const sheets = index
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a.name)![1]) - Number(/(\d+)\.xml$/.exec(b.name)![1]));
  if (sheets.length === 0) throw new Error("No worksheet found in the workbook.");

  const sharedEntry = index.find((e) => e.name === "xl/sharedStrings.xml");
  const shared = sharedEntry ? parseSharedStrings(await readEntry(buf, sharedEntry)) : [];
  const rows = parseSheet(await readEntry(buf, sheets[0]), shared);
  return { rows: rows.filter((r) => r.some((c) => c !== "")), sheetCount: sheets.length };
}
