/**
 * The asset-template sheet contract — one shared definition of the columns, used by
 * the worksheet export (written as .xlsx, see xlsxIo.ts) and by every import path,
 * .xlsx or .csv alike.
 *
 * The workflow it exists for: build ONE master template from a raw device payload,
 * export it, split the sheet into section-wise files in Excel (without touching the
 * header), then import those back. The `Device Template Name` column is what makes a
 * split file self-describing — a single sheet can carry rows for many templates, and
 * import routes each row to the template named in it (creating it if new).
 */

export interface AttrDef {
  name: string;
  type: string;
  dataType: string;
  tagName?: string;
  uom?: string;
  value?: string;
  required?: boolean;
  description?: string;
  /** Display rounding — null/undefined means "show the raw value". */
  decimalPlaces?: number;
}

/**
 * `deviceid` is not an attribute — it is the routing key that binds a payload to an
 * asset. It rides in this list so the whole binding can be declared in one place (the
 * template), and is peeled off before the definitions are stored: on a `deviceid` row
 * the Tag Name column holds the device id itself, e.g. `energy`.
 */
export const ATTR_TYPES = ["deviceid", "static", "dynamic", "metric", "timestamp"] as const;
export const DEVICE_ID_TYPE = "deviceid";

/** Split a definition list into the device id it declares and the real attributes. */
export function splitDeviceId(defs: AttrDef[]): { deviceId: string | null; attributes: AttrDef[] } {
  let deviceId: string | null = null;
  const attributes: AttrDef[] = [];
  for (const d of defs) {
    if (d.type === DEVICE_ID_TYPE) {
      const id = (d.value ?? d.tagName ?? "").trim();
      if (id && !deviceId) deviceId = id;
      continue;
    }
    attributes.push(d);
  }
  return { deviceId, attributes };
}
export const ATTR_DATATYPES = ["text", "number", "double", "boolean", "timestamp"] as const;

/** Exported header, in order. Import accepts these in any order, and is tolerant of
 *  casing/spacing, so a sheet re-saved by Excel still round-trips. */
export const TEMPLATE_CSV_HEADERS = [
  "Attribute Name", "Type", "Device Id", "Tag Name",
  "Data Type", "UoM", "Decimal Place", "Required",
] as const;

/** Header cell → field. Keys are normalised (lowercased, non-alphanumerics stripped),
 *  which is why "Attribute Name", "attribute_name" and "attributename" all land here.
 *  The short forms keep older exports (name,type,dataType,tagName,uom,…) importable. */
const HEADER_ALIASES: Record<string, keyof CsvRowFields> = {
  attributename: "name", name: "name",
  type: "type", attributetype: "type",
  // The device id is what every row in a file shares — a section sheet describes one
  // device. `devicetemplatename` stays mapped for sheets exported before the rename.
  deviceid: "deviceId", device: "deviceId", identifier: "deviceId",
  devicetemplatename: "templateName", templatename: "templateName", template: "templateName",
  tagname: "tagName", tag: "tagName", tagrelative: "tagName",
  datatype: "dataType",
  uom: "uom", unit: "uom", units: "uom",
  decimalplace: "decimalPlaces", decimalplaces: "decimalPlaces", decimals: "decimalPlaces",
  required: "required",
  description: "description", notes: "description",
};

interface CsvRowFields {
  name: string; type: string; templateName: string; deviceId: string; tagName: string;
  dataType: string; uom: string; decimalPlaces: string; required: string; description: string;
}

export interface CsvRow extends AttrDef {
  /** Which template this row belongs to (from the Device Template Name column). */
  templateName: string;
  /** 1-based line number in the source file, for error messages. */
  line: number;
}

export interface ParsedTemplateCsv {
  rows: CsvRow[];
  /** Distinct, non-empty Device Id values seen in the file (normally exactly one). */
  deviceIds: string[];
  /** Blocking — the import must not proceed while any of these are present. */
  errors: string[];
  /** Non-blocking — shown for review, most often an unrecognised tag. */
  warnings: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Split one CSV line, honouring quoted fields and "" escapes (Excel's output). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = ""; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Rows for the onboarding worksheet — one per attribute, in header order.
 *
 * Type and Data Type carry the master template's values rather than being blanked: by
 * export time they have already been decided once, and re-entering them per section
 * (200 cells for a 100-tag payload) is the work this sheet exists to avoid. They stay
 * editable in Excel — the columns have dropdowns.
 *
 * Attribute Name is the raw payload tag, same as Tag Name. That is the only column
 * meant to be rewritten by hand: rename it to whatever reads best, and leave Tag Name
 * exactly as the payload sends it.
 *
 * Every row repeats the Device Id, so a split file stays self-describing.
 */
export function templatesToRows(templates: { name: string; defs: AttrDef[]; deviceId?: string | null }[]): (string | number)[][] {
  const rows: (string | number)[][] = [];
  for (const t of templates) {
    for (const d of t.defs) {
      if (d.type === DEVICE_ID_TYPE) continue;   // the id is a column now, not a row
      rows.push([
        d.name, d.type ?? "", t.deviceId ?? "", d.tagName ?? "",
        d.dataType ?? "", d.uom ?? "", d.decimalPlaces ?? "", d.required ? "TRUE" : "FALSE",
      ]);
    }
  }
  return rows;
}

function parseRequired(raw: string, line: number, errors: string[]): boolean | undefined {
  const v = norm(raw);
  if (!v) return undefined;
  if (["true", "yes", "y", "1"].includes(v)) return true;
  if (["false", "no", "n", "0"].includes(v)) return false;
  errors.push(`Line ${line}: Required must be TRUE or FALSE (got "${raw}").`);
  return undefined;
}

function parseDecimals(raw: string, line: number, errors: string[]): number | undefined {
  if (!raw.trim()) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10) {
    errors.push(`Line ${line}: Decimal Place must be a whole number 0–10 (got "${raw}").`);
    return undefined;
  }
  return n;
}

export interface ParseOptions {
  /** Template name for the whole file — supplied by the import dialog. */
  defaultTemplateName?: string;
  /** Tags already known to the platform (lowercased). A row whose tag is absent gets a
   *  warning — never an error, because a template is often authored before its device
   *  has ever reported. */
  knownTags?: Set<string>;
}

/** CSV text → cell matrix → the shared validator below. */
export function parseTemplateCsv(text: string, opts: ParseOptions = {}): ParsedTemplateCsv {
  // Strip the UTF-8 BOM Excel prepends, or the first header cell never matches.
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  return parseTemplateRows(lines.map(splitCsvLine), opts);
}

/** Validates a sheet already read into cells — the single gate for CSV and XLSX alike. */
export function parseTemplateRows(cells: string[][], opts: ParseOptions = {}): ParsedTemplateCsv {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: CsvRow[] = [];

  const lines = cells.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  if (lines.length < 2) {
    errors.push("The file needs a header row and at least one attribute row.");
    return { rows, deviceIds: [], errors, warnings };
  }

  // Map each column position to a field; unrecognised columns are ignored, which lets
  // users keep their own working columns in the sheet.
  const header = lines[0];
  const cols = header.map((h) => HEADER_ALIASES[norm(h)]);
  const has = (f: keyof CsvRowFields) => cols.includes(f);

  for (const req of ["name", "type", "tagName", "dataType"] as const) {
    if (!has(req)) {
      const label = TEMPLATE_CSV_HEADERS.find((h) => HEADER_ALIASES[norm(h)] === req) ?? req;
      errors.push(`Missing required column: "${label}".`);
    }
  }
  if (errors.length > 0) return { rows, deviceIds: [], errors, warnings };

  // A file describes ONE device: its section templates are all fed by the same payload.
  const deviceIdSet = new Set<string>();

  // name/tag collisions are per-template, so they are tracked per template key.
  const seenNames = new Map<string, Set<string>>();
  const seenTags = new Map<string, Set<string>>();

  for (let i = 1; i < lines.length; i++) {
    const line = i + 1;
    const row = lines[i];
    const get = (f: keyof CsvRowFields) => {
      const idx = cols.indexOf(f);
      return idx === -1 ? "" : (row[idx] ?? "").trim();
    };

    const name = get("name");
    // The template name comes from the import dialog now; a legacy sheet that still has
    // a Device Template Name column keeps routing by it.
    const templateName = get("templateName") || opts.defaultTemplateName || "";
    const rowDeviceId = get("deviceId");
    if (rowDeviceId) deviceIdSet.add(rowDeviceId);
    const tagName = get("tagName");
    const type = get("type").toLowerCase();
    // A device-id row carries no payload value, so Data Type is meaningless on it —
    // default it rather than making the user fill a cell that changes nothing.
    const isDeviceId = type === DEVICE_ID_TYPE;
    const dataType = get("dataType").toLowerCase() || (isDeviceId ? "text" : "");

    // The export leaves Type / Device Template Name / Data Type blank for the user to
    // fill, so "you still have to fill this in" is the common case — say that, rather
    // than reporting an empty cell as an invalid value.
    if (!name) { errors.push(`Line ${line}: Attribute Name is required.`); continue; }
    if (!templateName) { errors.push(`Line ${line}: no template name — give one in the import dialog.`); continue; }
    if (!tagName) {
      errors.push(isDeviceId
        ? `Line ${line}: put the device id in the Tag Name column on a "${DEVICE_ID_TYPE}" row.`
        : `Line ${line}: Tag Name is required — it is what binds the attribute to the payload.`);
      continue;
    }
    if (!type) { errors.push(`Line ${line}: Type is empty — set it to one of ${ATTR_TYPES.join(", ")}.`); continue; }
    if (!ATTR_TYPES.includes(type as any)) {
      errors.push(`Line ${line}: Type "${get("type")}" is not valid (use ${ATTR_TYPES.join(", ")}).`);
      continue;
    }
    if (!dataType) { errors.push(`Line ${line}: Data Type is empty — set it to one of ${ATTR_DATATYPES.join(", ")}.`); continue; }
    if (!ATTR_DATATYPES.includes(dataType as any)) {
      errors.push(`Line ${line}: Data Type "${get("dataType")}" is not valid (use ${ATTR_DATATYPES.join(", ")}).`);
      continue;
    }

    const key = templateName.toLowerCase();
    const names = seenNames.get(key) ?? new Set<string>();
    const tags = seenTags.get(key) ?? new Set<string>();
    if (names.has(name.toLowerCase())) {
      errors.push(`Line ${line}: "${name}" appears twice in template "${templateName}".`);
      continue;
    }
    // Two attributes on one asset fed by the same payload key would both be written on
    // every ingest — almost always a copy/paste slip when splitting the master sheet.
    if (tags.has(tagName.toLowerCase())) {
      errors.push(`Line ${line}: tag "${tagName}" is used twice in template "${templateName}".`);
      continue;
    }
    names.add(name.toLowerCase()); seenNames.set(key, names);
    tags.add(tagName.toLowerCase()); seenTags.set(key, tags);

    // A device-id row's "tag" is the device id, not a payload key — checking it against
    // known tags would flag every one of them.
    if (!isDeviceId && opts.knownTags && opts.knownTags.size > 0 && !opts.knownTags.has(tagName.toLowerCase())) {
      warnings.push(`Line ${line}: tag "${tagName}" does not match any tag already known to the platform — check it against the payload, or ignore this if the device is new.`);
    }

    const required = parseRequired(get("required"), line, errors);
    const decimalPlaces = parseDecimals(get("decimalPlaces"), line, errors);
    const uom = get("uom");
    const description = get("description");

    rows.push({
      templateName, line, name, type, dataType, tagName,
      ...(rowDeviceId ? { value: rowDeviceId } : {}),
      ...(uom ? { uom } : {}),
      ...(description ? { description } : {}),
      ...(required !== undefined ? { required } : {}),
      ...(decimalPlaces !== undefined ? { decimalPlaces } : {}),
    });
  }

  if (rows.length === 0 && errors.length === 0) errors.push("No attribute rows found.");

  const deviceIds = [...deviceIdSet];
  if (deviceIds.length > 1) {
    errors.push(`This file lists ${deviceIds.length} different Device Ids (${deviceIds.join(", ")}). One file describes one device — split it, or correct the column.`);
  }
  return { rows, deviceIds, errors, warnings };
}

/** Group parsed rows by template, preserving first-seen casing and file order. */
export function groupRowsByTemplate(rows: CsvRow[]): { name: string; defs: AttrDef[] }[] {
  const groups = new Map<string, { name: string; defs: AttrDef[] }>();
  for (const { templateName, line: _line, ...def } of rows) {
    const key = templateName.toLowerCase();
    const g = groups.get(key) ?? { name: templateName, defs: [] };
    g.defs.push(def);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** Merge imported defs into a template's existing ones: a row whose tag (or, failing
 *  that, name) already exists updates that definition in place; anything else is
 *  appended. Never drops definitions the CSV happens to omit — that is what makes it
 *  safe to import a section file into a template built from the master. */
export function mergeDefs(existing: AttrDef[], incoming: AttrDef[]): { defs: AttrDef[]; updated: number; added: number } {
  const defs = [...existing];
  let updated = 0; let added = 0;
  for (const inc of incoming) {
    const tag = inc.tagName?.toLowerCase();
    let idx = tag ? defs.findIndex((d) => d.tagName?.toLowerCase() === tag) : -1;
    if (idx === -1) idx = defs.findIndex((d) => d.name.toLowerCase() === inc.name.toLowerCase());
    if (idx === -1) { defs.push(inc); added++; }
    else { defs[idx] = { ...defs[idx], ...inc }; updated++; }
  }
  return { defs, updated, added };
}
