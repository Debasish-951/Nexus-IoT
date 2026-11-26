import { BEHAVIOURS, newItemId, type Behaviour, type TwinItem } from "./types";
import type { Part } from "./sanitize";
import { csvCell } from "@/lib/csv";

/**
 * Mapping as CSV, for drawings with many points.
 * Columns: part,asset_identifier_or_name,metric,behaviours,unit,decimals,warn,crit,min,max
 * `behaviours` is a "|"-separated list of: value, status, fill, scale, rotate,
 * blink, visible, text. A row whose part is an SVG element without an item yet
 * creates the item; drawn regions and pins must exist (matched by name).
 */
export const CSV_COLUMNS = ["part", "asset_identifier_or_name", "metric", "behaviours", "unit", "decimals", "warn", "crit", "min", "max"] as const;
const VALID = new Set<string>(BEHAVIOURS.map((b) => b.k));

/** The shared escaper: quotes when needed, and a text cell starting with = + - @ tab or CR gets a ' so spreadsheets do not run it as a formula (numbers stay numbers). */
const esc = csvCell;

export function toCsv(items: TwinItem[], assets: { id: string; name: string; identifier?: string | null }[]): string {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const rows = items.map((i) => {
    const a = i.assetId ? byId.get(i.assetId) : undefined;
    return [i.kind === "part" ? i.ref ?? i.name : i.name, a ? (a.identifier || a.name) : "", i.metric ?? "", i.behaviours.join("|"), i.unit ?? "", i.decimals ?? "", i.warn ?? "", i.crit ?? "", i.min ?? "", i.max ?? ""].map(esc).join(",");
  });
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n");
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export interface CsvResult { items: TwinItem[]; applied: number; created: number; problems: string[] }

export function applyCsv(text: string, items: TwinItem[], parts: Part[], assets: { id: string; name: string; identifier?: string | null }[]): CsvResult {
  const rows = parseCsv(text);
  const problems: string[] = [];
  if (!rows.length) return { items, applied: 0, created: 0, problems: ["The file is empty."] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (n: string) => head.indexOf(n);
  if (col("part") < 0) return { items, applied: 0, created: 0, problems: [`Missing header. The first row must be: ${CSV_COLUMNS.join(",")}`] };
  const next = items.map((i) => ({ ...i }));
  const norm = (s: string) => s.trim().toLowerCase();
  let applied = 0, created = 0;
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const get = (n: string) => { const c = col(n); return c >= 0 ? (r[c] ?? "").trim().replace(/^'(?=[=+@\t\r-])/, "") : ""; };
    const key = get("part");
    if (!key) { problems.push(`Row ${line}: no part.`); return; }
    let it = next.find((i) => (i.kind === "part" && i.ref === key) || norm(i.name) === norm(key));
    if (!it) {
      const p = parts.find((x) => x.ref === key || norm(x.name) === norm(key));
      if (!p) { problems.push(`Row ${line}: no part or region named "${key}".`); return; }
      it = { id: newItemId(), kind: "part", ref: p.ref, name: p.name, behaviours: ["value", "status"] };
      next.push(it); created++;
    }
    const an = get("asset_identifier_or_name");
    if (an) {
      const a = assets.find((x) => x.identifier === an) ?? assets.find((x) => norm(x.name) === norm(an));
      if (!a) problems.push(`Row ${line}: asset "${an}" is not in this project; the link was skipped.`);
      else it.assetId = a.id;
    }
    const m = get("metric"); if (m) it.metric = m;
    const bh = get("behaviours");
    if (bh) {
      const list = bh.split(/[|;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      const bad = list.filter((x) => !VALID.has(x));
      if (bad.length) problems.push(`Row ${line}: unknown behaviour ${bad.join(", ")}.`);
      const ok = list.filter((x) => VALID.has(x)) as Behaviour[];
      if (ok.length) it.behaviours = ok;
    }
    const unit = get("unit"); if (unit) it.unit = unit.slice(0, 20);
    for (const f of ["decimals", "warn", "crit", "min", "max"] as const) {
      const v = get(f);
      if (!v) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) { problems.push(`Row ${line}: ${f} "${v}" is not a number.`); continue; }
      (it as any)[f] = f === "decimals" ? Math.max(0, Math.min(6, Math.round(n))) : n;
    }
    applied++;
  });
  return { items: next, applied, created, problems };
}
