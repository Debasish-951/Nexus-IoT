/**
 * The one way the frontend writes CSV.
 *
 * Mirrors `csvCell` in api-server/src/lib/validation.ts. Values come from devices
 * and users, so a cell starting with = + - @ (or tab / CR) would run as a formula
 * when a colleague opens the file in Excel; it is prefixed with a single quote so
 * it is shown as text. Real numbers are left alone, so -3.2 stays a number.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  let s = value instanceof Date ? value.toISOString() : String(value);
  // Control characters break the row structure regardless of quoting.
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One CSV line. */
export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

/** Header plus rows, newline-joined. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return [csvRow(header), ...rows.map(csvRow)].join("\n");
}

/** Save CSV text as a file download. */
export function downloadCsvText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
